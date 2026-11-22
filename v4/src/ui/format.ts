import { groupThousands } from '../domain/calc.ts';

export const tenge = (n: number) => groupThousands(n);
export const signed = (n: number, kind: 'expense' | 'income') => (kind === 'income' ? '+' : '−') + groupThousands(n) + ' ₸';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function dayMonth(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function dayHeader(ts: number, now: number): string {
  const a = new Date(ts);
  const b = new Date(now);
  const same = (x: Date, y: Date) => x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  if (same(a, b)) return 'Сегодня';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (same(a, y)) return 'Вчера';
  return `${a.getDate()} ${MONTHS[a.getMonth()]}`;
}

export function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function daysWord(n: number): string {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return 'день';
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'дня';
  return 'дней';
}
