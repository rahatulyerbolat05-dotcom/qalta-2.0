// The day figure: how much can be spent today so that the money on the accounts lasts
// until the chosen date. Derived on every read, never stored, so edits from two devices
// cannot leave a stale figure behind.

export type TxKind = 'expense' | 'income' | 'transfer';

// Every stored record carries an update stamp and a deletion flag, so two devices can
// merge record by record (see merge.ts) and a deletion is never undone by an old copy.
export interface Stamped {
  id: string;
  updatedAt: number;
  deleted?: boolean;
}

export interface Account extends Stamped {
  name: string;
  kind: 'card' | 'cash';
  openingAmount: number; // whole tenge the person had at openingAt
  openingAt: number; // ms; a correction moves this anchor to "now"
  order: number;
}

export interface Tx extends Stamped {
  kind: TxKind;
  amount: number; // positive whole tenge
  accountId: string;
  toAccountId?: string; // transfers only
  envelopeId?: string; // an expense paid from an envelope: not part of today's spending
  category: string; // empty for transfers
  note: string;
  at: number; // when it happened, ms
  createdAt: number;
}

export interface DayFigure {
  allowance: number; // what today was allowed at the start of the day (plus today's income)
  spent: number; // expenses recorded for today
  left: number; // allowance - spent; negative means over the figure
  daysLeft: number; // today included
  balance: number; // money on all accounts now
}

const DAY = 86_400_000;

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// 'YYYY-MM-DD' → local midnight of that day.
export function dayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function ymd(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A moment on the given day at the current time of day (or at 12:00 for a past day when
// asked), never in the future.
export function momentOn(day: string, now: number): number {
  if (day === ymd(now)) return now; // today means right now, to the millisecond
  const d = new Date(now);
  const t = dayOf(day) + (d.getHours() * 60 + d.getMinutes()) * 60_000;
  return Math.min(t, now);
}

// Days from today to `until`, both included; at least 1 so the figure never divides by 0.
export function daysUntil(now: number, until: string): number {
  const diff = Math.round((dayOf(until) - startOfDay(now)) / DAY);
  return Math.max(1, diff + 1);
}

const live = <T extends Stamped>(xs: readonly T[]) => xs.filter((x) => !x.deleted);

// The amount entered is a statement "at this moment I have X": operations dated before
// it are already inside it, as in the prototype's balances().
export function accountBalance(acc: Account, txs: readonly Tx[]): number {
  let sum = acc.openingAmount;
  for (const tx of txs) {
    if (tx.deleted || tx.at < acc.openingAt) continue;
    if (tx.kind === 'transfer') {
      if (tx.accountId === acc.id) sum -= tx.amount;
      if (tx.toAccountId === acc.id) sum += tx.amount;
    } else if (tx.accountId === acc.id) sum += tx.kind === 'income' ? tx.amount : -tx.amount;
  }
  return sum;
}

// `reserved` is the money in envelopes (envelopes.ts reservedTotal): it is not free to spend.
export function dayFigure(accountsAll: readonly Account[], txsAll: readonly Tx[], now: number, until: string, reserved = 0): DayFigure {
  const accounts = live(accountsAll);
  const txs = live(txsAll);
  const today = startOfDay(now);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  let balance = 0;
  for (const a of accounts) balance += accountBalance(a, txs);
  let spent = 0;
  for (const tx of txs) {
    if (tx.kind !== 'expense' || tx.at < today || tx.envelopeId) continue;
    const acc = byId.get(tx.accountId);
    if (acc && tx.at >= acc.openingAt) spent += tx.amount;
  }
  const daysLeft = daysUntil(now, until);
  const base = balance - reserved + spent; // free money at the start of today, with today's income
  const allowance = Math.max(0, Math.floor(base / daysLeft));
  return { allowance, spent, left: allowance - spent, daysLeft, balance };
}

// Usage counts per category, most used first: orders the chips in the entry sheet.
export function categoryUsage(txs: readonly Tx[], kind: 'expense' | 'income', limit = 400): Map<string, number> {
  const m = new Map<string, number>();
  let seen = 0;
  for (const tx of txs) {
    if (tx.deleted || tx.kind !== kind || tx.envelopeId) continue;
    m.set(tx.category, (m.get(tx.category) ?? 0) + 1);
    if (++seen >= limit) break;
  }
  return m;
}
