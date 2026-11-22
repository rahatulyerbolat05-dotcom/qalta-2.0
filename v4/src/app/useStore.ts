import { useEffect, useState } from 'preact/hooks';
import { store, type State } from '../data/store.ts';

export function useStore(): State {
  const [s, set] = useState(store.state);
  useEffect(() => store.subscribe(set), []);
  return s;
}

// Re-render at local midnight so the day figure rolls over while the app stays open.
export function useToday(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const d = new Date();
    d.setHours(24, 0, 5, 0);
    const t = setTimeout(() => setNow(Date.now()), d.getTime() - Date.now());
    const onShow = () => document.visibilityState === 'visible' && setNow(Date.now());
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [now]);
  return now;
}
