// Motion: real spring curves for CSS and Web Animations, a number tween and a swipe
// recogniser. Only transform and opacity are animated; Reduce Motion turns movement off.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

export const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Simulates a damped spring and samples it into a CSS linear() easing, so CSS transitions
// and element.animate() move like UIKit springs (overshoot included when damping allows).
export function springCurve(stiffness: number, damping: number, mass = 1): { easing: string; ms: number } {
  const dt = 1 / 120;
  let x = 0, v = 0, t = 0;
  const pts: number[] = [];
  while (t < 3) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    t += dt;
    pts.push(x);
    if (t > 0.1 && Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) break;
  }
  const step = Math.max(1, Math.floor(pts.length / 48));
  const sampled = pts.filter((_, i) => i % step === 0);
  sampled[sampled.length - 1] = 1;
  return { easing: `linear(0, ${sampled.map((p) => +p.toFixed(4)).join(', ')})`, ms: Math.round(t * 1000) };
}

const SUPPORTS_LINEAR = typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', 'linear(0, 1)');
const FALLBACK = 'cubic-bezier(.32,.72,0,1)';

export const SPRING = SUPPORTS_LINEAR ? springCurve(420, 38) : { easing: FALLBACK, ms: 420 }; // calm, no visible bounce
export const BOUNCY = SUPPORTS_LINEAR ? springCurve(520, 30) : { easing: FALLBACK, ms: 480 }; // a little overshoot

// Expose to CSS once: var(--ease-spring) / var(--dur-spring) and the bouncy variant.
export function installMotion() {
  const r = document.documentElement.style;
  r.setProperty('--ease-spring', SPRING.easing);
  r.setProperty('--dur-spring', `${SPRING.ms}ms`);
  r.setProperty('--ease-bouncy', BOUNCY.easing);
  r.setProperty('--dur-bouncy', `${BOUNCY.ms}ms`);
}

export function animate(el: Element | null | undefined, frames: Keyframe[], opts: { ms?: number; bouncy?: boolean; delay?: number } = {}) {
  if (!el || reduced() || !el.animate) return;
  const s = opts.bouncy ? BOUNCY : SPRING;
  el.animate(frames, { duration: opts.ms ?? s.ms, easing: s.easing, delay: opts.delay ?? 0, fill: 'both' });
}

// A number that glides to its new value (the day figure after each entry).
export function useTween(value: number, ms = 520): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced() || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const a = from.current, b = value, t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(a + (b - a) * e);
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

// ───────── swipes ─────────

export interface SwipeHandlers {
  axis: 'x' | 'y';
  capture?: boolean; // capture the pointer at once (a drag handle with nothing to click inside)
  onStart?: () => void;
  onMove: (d: number, other: number) => void;
  onEnd: (d: number, velocity: number) => void; // velocity in px/ms along the axis
  onCancel?: () => void;
}

// Pointer-based swipe along one axis. The gesture is claimed only once it clearly moves
// along that axis (10 px, and more than across), so taps and the other direction pass
// through. Returns props to spread on the element.
export function swipe(h: SwipeHandlers) {
  let sx = 0, sy = 0, active = false, claimed = false, id = -1;
  let samples: Array<[number, number]> = [];
  const along = (e: PointerEvent) => (h.axis === 'x' ? e.clientX - sx : e.clientY - sy);
  const across = (e: PointerEvent) => (h.axis === 'x' ? e.clientY - sy : e.clientX - sx);
  return {
    onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      sx = e.clientX;
      sy = e.clientY;
      active = true;
      claimed = false;
      id = e.pointerId;
      samples = [[e.timeStamp, 0]];
      if (h.capture) (e.currentTarget as Element).setPointerCapture?.(id);
    },
    onPointerMove(e: PointerEvent) {
      if (!active || e.pointerId !== id) return;
      const d = along(e), o = across(e);
      if (!claimed) {
        if (Math.abs(o) > 10 && Math.abs(o) > Math.abs(d)) {
          active = false;
          return;
        }
        if (Math.abs(d) < 10) return;
        claimed = true;
        (e.currentTarget as Element).setPointerCapture?.(id);
        h.onStart?.();
      }
      e.stopPropagation();
      samples.push([e.timeStamp, d]);
      if (samples.length > 6) samples.shift();
      h.onMove(d, o);
    },
    onPointerUp(e: PointerEvent) {
      if (!active || e.pointerId !== id) return;
      active = false;
      if (!claimed) return;
      e.stopPropagation();
      const d = along(e);
      const [t0, d0] = samples[0];
      const dt = Math.max(1, e.timeStamp - t0);
      h.onEnd(d, (d - d0) / dt);
    },
    onPointerCancel() {
      if (claimed) h.onCancel?.();
      active = false;
      claimed = false;
    },
    onClickCapture(e: MouseEvent) {
      if (claimed) {
        e.stopPropagation();
        e.preventDefault();
        claimed = false;
      }
    },
  };
}

// Stable swipe props whose handlers always see the latest render.
export function useSwipe(h: SwipeHandlers) {
  const r = useRef(h);
  r.current = h;
  return useMemo(
    () =>
      swipe({
        axis: h.axis,
        capture: h.capture,
        onStart: () => r.current.onStart?.(),
        onMove: (d, o) => r.current.onMove(d, o),
        onEnd: (d, v) => r.current.onEnd(d, v),
        onCancel: () => r.current.onCancel?.(),
      }),
    []
  );
}
