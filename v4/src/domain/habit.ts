// The habit: an evening check-in ("today's records are right"), a weekly review and a
// pause before buying. Pure functions, tested in tests/domain.test.mjs.
import type { Stamped, Tx } from './daily.ts';
import { startOfDay, ymd } from './daily.ts';

const DAY = 86_400_000;

export interface Checkin extends Stamped {
  // id is the day, 'YYYY-MM-DD': one check-in per day, the same document from every device
  day: string;
  done: boolean;
  at: number;
  decision: string; // the one decision for next week, written on the weekly review
}

export interface Wish extends Stamped {
  title: string;
  price: number;
  createdAt: number;
  decideAt: number;
  status: 'waiting' | 'bought' | 'dropped';
}

export interface HabitStats {
  doneToday: boolean;
  streak: number; // check-ins in the current run; one missed day does not break it
  last30: number; // days with a check-in among the last 30, today included
}

// Lally et al. (2010): a single missed day barely affects habit formation, so one gap is
// forgiven; two missed days in a row end the run. No shame mechanics.
export function habitStats(checkins: readonly Checkin[], now: number): HabitStats {
  const days = new Set(checkins.filter((c) => !c.deleted && c.done).map((c) => c.day));
  const today = ymd(now);
  let streak = 0;
  let gap = 0;
  // start from today if done, else from yesterday (today is still open)
  let t = days.has(today) ? startOfDay(now) : startOfDay(now) - DAY;
  for (let i = 0; i < 400; i++, t -= DAY) {
    if (days.has(ymd(t))) {
      streak++;
      gap = 0;
    } else if (++gap >= 2) break;
  }
  let last30 = 0;
  for (let i = 0; i < 30; i++) if (days.has(ymd(startOfDay(now) - i * DAY))) last30++;
  return { doneToday: days.has(today), streak, last30 };
}

// The evening card shows from the reminder time until midnight, unless today is done.
export function checkinDue(reminder: string, now: number, doneToday: boolean): boolean {
  if (doneToday || !/^\d{2}:\d{2}$/.test(reminder)) return false;
  const [h, m] = reminder.split(':').map(Number);
  const d = new Date(now);
  return d.getHours() * 60 + d.getMinutes() >= h * 60 + m;
}

export function weekStart(now: number): number {
  const d = new Date(startOfDay(now));
  const back = (d.getDay() + 6) % 7; // Monday = 0
  return d.getTime() - back * DAY;
}

export interface WeekSummary {
  spent: number;
  prevSpent: number;
  records: number;
  topCategory: string;
  topAmount: number;
  checkins: number;
}

// Three facts for Sunday's review: this week against the last, the biggest category, the
// evenings checked. Expenses paid from envelopes are counted: they are spending too.
export function weekSummary(txs: readonly Tx[], checkins: readonly Checkin[], now: number): WeekSummary {
  const from = weekStart(now), prevFrom = from - 7 * DAY;
  let spent = 0, prevSpent = 0, records = 0;
  const byCat = new Map<string, number>();
  for (const t of txs) {
    if (t.deleted || t.kind !== 'expense') continue;
    if (t.at >= from) {
      spent += t.amount;
      records++;
      byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount);
    } else if (t.at >= prevFrom && t.at < from) prevSpent += t.amount;
  }
  let topCategory = '', topAmount = 0;
  for (const [c, v] of byCat) if (v > topAmount) [topCategory, topAmount] = [c, v];
  const days = new Set(checkins.filter((c) => !c.deleted && c.done && c.at >= from).map((c) => c.day));
  return { spent, prevSpent, records, topCategory, topAmount, checkins: days.size };
}

export const isSunday = (now: number) => new Date(now).getDay() === 0;

// A wish waits until its decision time; its price is shown in days of the day figure.
export function wishDays(price: number, allowance: number): number {
  return allowance > 0 ? Math.ceil(price / allowance) : 0;
}

export function wishReady(w: Wish, now: number): boolean {
  return w.status === 'waiting' && now >= w.decideAt;
}
