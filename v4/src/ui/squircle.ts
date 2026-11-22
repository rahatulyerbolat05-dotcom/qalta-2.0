// Smoothed corners with a corner-smoothing percentage, the way Figma draws them
// (60 % is the iOS look). The geometry follows Figma's published method: each corner is
// a circular arc in the middle, eased into the straight edge by two Bézier curves; the
// smoothing stretches the corner along the edge by (1 + smoothing) × radius.
// Reference: figma.com/blog/desperately-seeking-squircles and the MIT figma-squircle code.
//
// The same path is used in every browser (as clip-path), so the shape is identical on
// iPhone and desktop; the CSS corner-shape keyword has no smoothing percentage.
import { useLayoutEffect, useRef } from 'preact/hooks';

export const SMOOTHING = 0.6;

const rad = (deg: number) => (deg * Math.PI) / 180;

interface Corner {
  a: number;
  b: number;
  c: number;
  d: number;
  p: number;
  arc: number;
  r: number;
}

function corner(radius: number, smoothing: number, budget: number): Corner {
  let s = smoothing;
  let p = (1 + s) * radius;
  // Not enough room along the edge: reduce smoothing first, keep the radius.
  const maxSmoothing = budget / radius - 1;
  s = Math.max(0, Math.min(s, maxSmoothing));
  p = Math.min(p, budget);
  const arcMeasure = 90 * (1 - s);
  const arc = Math.sin(rad(arcMeasure / 2)) * radius * Math.SQRT2;
  const alpha = (90 - arcMeasure) / 2;
  const p3p4 = radius * Math.tan(rad(alpha / 2));
  const beta = 45 * s;
  const c = p3p4 * Math.cos(rad(beta));
  const d = c * Math.tan(rad(beta));
  const b = (p - arc - c - d) / 3;
  const a = 2 * b;
  return { a, b, c, d, p, arc, r: radius };
}

const n = (v: number) => (Math.abs(v) < 1e-4 ? '0' : v.toFixed(2).replace(/\.?0+$/, ''));

export function squirclePath(width: number, height: number, radius: number, smoothing = SMOOTHING): string {
  const budget = Math.min(width, height) / 2;
  const r = Math.max(0, Math.min(radius, budget));
  if (r === 0) return `M0 0H${n(width)}V${n(height)}H0Z`;
  const { a, b, c, d, p, arc } = corner(r, smoothing, budget);
  const ab = a + b, abc = a + b + c, bc = b + c;
  return [
    `M${n(width - p)} 0`,
    `c${n(a)} 0 ${n(ab)} 0 ${n(abc)} ${n(d)}`,
    `a${n(r)} ${n(r)} 0 0 1 ${n(arc)} ${n(arc)}`,
    `c${n(d)} ${n(c)} ${n(d)} ${n(bc)} ${n(d)} ${n(abc)}`,
    `L${n(width)} ${n(height - p)}`,
    `c0 ${n(a)} 0 ${n(ab)} ${n(-d)} ${n(abc)}`,
    `a${n(r)} ${n(r)} 0 0 1 ${n(-arc)} ${n(arc)}`,
    `c${n(-c)} ${n(d)} ${n(-bc)} ${n(d)} ${n(-abc)} ${n(d)}`,
    `L${n(p)} ${n(height)}`,
    `c${n(-a)} 0 ${n(-ab)} 0 ${n(-abc)} ${n(-d)}`,
    `a${n(r)} ${n(r)} 0 0 1 ${n(-arc)} ${n(-arc)}`,
    `c${n(-d)} ${n(-c)} ${n(-d)} ${n(-bc)} ${n(-d)} ${n(-abc)}`,
    `L0 ${n(p)}`,
    `c0 ${n(-a)} 0 ${n(-ab)} ${n(d)} ${n(-abc)}`,
    `a${n(r)} ${n(r)} 0 0 1 ${n(arc)} ${n(-arc)}`,
    `c${n(c)} ${n(-d)} ${n(bc)} ${n(-d)} ${n(abc)} ${n(-d)}`,
    'Z',
  ].join('');
}

// Attach to an element with class "sq" and --r set. Until the first measurement the
// element shows a plain border-radius, so nothing jumps.
export function useSquircle<T extends HTMLElement>(radius: number, smoothing = SMOOTHING) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let w = 0, h = 0;
    const apply = () => {
      const nw = el.offsetWidth, nh = el.offsetHeight;
      if (!nw || !nh || (nw === w && nh === h)) return;
      w = nw;
      h = nh;
      el.style.clipPath = `path('${squirclePath(nw, nh, radius, smoothing)}')`;
      el.style.borderRadius = '0';
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [radius, smoothing]);
  return ref;
}
