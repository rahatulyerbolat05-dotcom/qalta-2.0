import type { ButtonHTMLAttributes, ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useSquircle } from './squircle.ts';
import { SPRING, reduced, useSwipe } from './motion.ts';

// ───────── shapes ─────────

type SqProps = ButtonHTMLAttributes<HTMLElement> & { r: number; tag?: 'div' | 'button' | 'section' | 'label' };

export function Sq({ r, tag = 'div', class: cls, style, ...rest }: SqProps) {
  const ref = useSquircle<HTMLElement>(r);
  const Tag = tag as 'div';
  const st = typeof style === 'object' && style ? { ...(style as object), '--r': `${r}px` } : typeof style === 'string' ? `${style};--r:${r}px` : { '--r': `${r}px` };
  return <Tag ref={ref as never} class={`sq ${cls ?? ''}`} style={st as never} {...(rest as object)} />;
}

// ───────── icons (stroke, 24 grid) ─────────

const PATHS: Record<string, JSX.Element> = {
  out: <path d="M7 17 17 7M9 7h8v8" />,
  in: <path d="M17 7 7 17M15 17H7V9" />,
  people: (
    <g>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 19a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 4.5" />
    </g>
  ),
  home: <path d="M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4z" />,
  wallet: (
    <g>
      <rect x="3" y="6" width="18" height="13" rx="3" />
      <path d="M3 10h18M16 15h2" />
    </g>
  ),
  calendar: (
    <g>
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </g>
  ),
  back: <path d="M9 5h11v14H9l-6-7zM12 9l5 6M17 9l-5 6" />,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  repeat: <path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />,
  swap: <path d="M4 8h14l-3-3M20 16H6l3 3" />,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  user: (
    <g>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </g>
  ),
  cloud: <path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.5 4.25 4.25 0 0 0 7 18z" />,
  coffee: <path d="M5 9h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17" />,
  bag: <path d="M6 8h12l-1 12H7zM9 8a3 3 0 0 1 6 0" />,
  car: (
    <g>
      <path d="M4 16v-4l2-5h12l2 5v4z" />
      <circle cx="8" cy="16.5" r="1.5" />
      <circle cx="16" cy="16.5" r="1.5" />
    </g>
  ),
  bus: (
    <g>
      <rect x="5" y="4" width="14" height="13" rx="3" />
      <path d="M5 11h14M8 20v-3M16 20v-3" />
    </g>
  ),
  phone: (
    <g>
      <rect x="7" y="3" width="10" height="18" rx="3" />
      <path d="M11 18h2" />
    </g>
  ),
  pill: <path d="M8.5 15.5 15.5 8.5a3.5 3.5 0 0 0-5-5L3.5 10.5a3.5 3.5 0 0 0 5 5zM7 7l5 5" />,
  house: <path d="M4 11 12 4l8 7M6 10v10h12V10" />,
  bulb: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" />,
  wifi: <path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  shirt: <path d="M8 3 3 6l2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z" />,
  gift: <path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3-2-5 1" />,
  film: (
    <g>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M8 5v14M16 5v14" />
    </g>
  ),
  fuel: <path d="M5 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M4 20h12M15 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3M8 8h4" />,
  wrench: <path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-2-2z" />,
  repeat2: <path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5" />,
  sport: <path d="M6 9v6M18 9v6M3 11v2M21 11v2M6 12h12" />,
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  child: (
    <g>
      <circle cx="12" cy="6" r="3" />
      <path d="M8 21v-6l-2-3 3-2h6l3 2-2 3v6" />
    </g>
  ),
  book: <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5" />,
  mic: <path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v3" />,
  dots: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
};

export function Icon({ name, size = 22, stroke = 1.9 }: { name: string; size?: number; stroke?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round">
      {PATHS[name] ?? PATHS.dots}
    </svg>
  );
}

const CAT_ICON: Record<string, string> = {
  Кафе: 'coffee', Продукты: 'bag', Такси: 'car', Транспорт: 'bus', Связь: 'phone', Интернет: 'wifi', Аптека: 'pill', Врачи: 'heart',
  Дом: 'house', Коммуналка: 'bulb', Одежда: 'shirt', Обувь: 'shirt', Дети: 'child', Школа: 'book', Спорт: 'sport', Красота: 'sparkle',
  Подарки: 'gift', Развлечения: 'film', Бензин: 'fuel', Ремонт: 'wrench', Подписки: 'repeat2',
  Гонорар: 'mic', Зарплата: 'in', Подработка: 'in', Подарок: 'gift', Возврат: 'in', Проценты: 'in', 'Аренда сдал': 'house',
  Перевод: 'swap',
};
export const catIcon = (c: string) => CAT_ICON[c] ?? 'dots';

// ───────── bottom sheet ─────────

interface SheetProps {
  open: boolean;
  label: string;
  onClose: () => void;
  children: ComponentChildren;
}

// Slides up on a spring; the screen behind steps back (App adds .behind). Dragging the top
// part follows the finger, stretches like rubber when pulled up, and closes on a long or
// fast pull down. Tap outside, Escape and the back gesture close it too.
export function Sheet({ open, label, onClose, children }: SheetProps) {
  const [shown, setShown] = useState(open);
  const [entered, setEntered] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      opener.current = document.activeElement;
      setShown(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    } else if (shown) {
      setEntered(false);
      setDrag(null);
      const t = setTimeout(() => {
        setShown(false);
        (opener.current as HTMLElement | null)?.focus?.();
      }, reduced() ? 0 : SPRING.ms);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!entered) return;
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [entered]);

  const sw = useSwipe({
    axis: 'y',
    capture: true,
    onMove: (d) => {
      if (panel.current && panel.current.scrollTop > 0 && d > 0) return;
      setDrag(d >= 0 ? d : -Math.pow(-d, 0.7)); // rubber band upwards
    },
    onEnd: (d, v) => {
      const h = panel.current?.offsetHeight ?? 600;
      if (d > h * 0.3 || v > 0.55) onClose();
      setDrag(null);
    },
    onCancel: () => setDrag(null),
  });

  if (!shown) return null;
  const style = drag !== null ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined;
  const scrim = drag !== null && drag > 0 ? { opacity: String(Math.max(0, 1 - drag / 500)), transition: 'none' } : undefined;

  return (
    <div class={`sheet-wrap ${entered ? 'in' : ''}`}>
      <div class="sheet-scrim" style={scrim} onClick={onClose} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} class="sheet" style={style}>
        <div class="sheet-grab" {...sw}>
          <span />
        </div>
        {children}
      </div>
    </div>
  );
}

// ───────── toast with an undo action ─────────

export interface ToastData {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export function Toast({ toast, onDone }: { toast: ToastData | null; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    setLeaving(false);
    if (!toast) return;
    const t1 = setTimeout(() => setLeaving(true), 5600);
    const t2 = setTimeout(onDone, 6000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [toast?.id]);
  const sw = useSwipe({ axis: 'y', onMove: () => {}, onEnd: (d) => d > 20 && onDone() });
  if (!toast) return null;
  return (
    <div class={`toast ${leaving ? 'out' : ''}`} role="status" key={toast.id} {...sw}>
      <span>{toast.text}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.run();
            onDone();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

// ───────── tab bar with a sliding pill ─────────

export function Tabs<T extends string>({ items, value, onChange }: { items: Array<{ id: T; label: string; icon: string }>; value: T; onChange: (t: T) => void }) {
  const nav = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>(`[data-tab="${value}"]`);
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value]);
  return (
    <nav class="tabs" aria-label="Разделы" ref={nav}>
      {pill && <span class="tabs-pill" style={{ transform: `translateX(${pill.x}px)`, width: `${pill.w}px` }} aria-hidden="true" />}
      {items.map((it) => (
        <button key={it.id} data-tab={it.id} aria-label={it.label} aria-current={value === it.id ? 'page' : undefined} class={value === it.id ? 'on' : ''} onClick={() => onChange(it.id)}>
          <Icon name={it.icon} />
        </button>
      ))}
    </nav>
  );
}
