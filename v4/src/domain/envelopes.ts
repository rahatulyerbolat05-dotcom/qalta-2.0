// Envelopes: money set aside with a purpose. Income is split by rules the person set in
// advance (a percent of each income or a fixed amount), so the decision is made before the
// money is in the pocket. The day figure counts only what is left outside the envelopes.
import type { Stamped, Tx } from './daily.ts';

export type EnvelopeKind = 'reserve' | 'goal' | 'obligation';

export interface Envelope extends Stamped {
  name: string;
  kind: EnvelopeKind;
  ruleMode: 'percent' | 'fixed' | 'none';
  ruleValue: number; // percent 0–100, or whole tenge for 'fixed'
  target: number; // goals: amount to collect; 0 when none
  order: number;
}

// A movement of money into (+) or out of (−) an envelope; incomeTxId links a split to its income.
export interface Allocation extends Stamped {
  envelopeId: string;
  amount: number;
  at: number;
  incomeTxId: string;
  note: string;
}

const live = <T extends Stamped>(xs: readonly T[]) => xs.filter((x) => !x.deleted);

// What an envelope holds: everything put in, minus taken out, minus expenses paid from it.
export function envelopeBalance(env: Envelope, allocations: readonly Allocation[], txs: readonly Tx[]): number {
  let sum = 0;
  for (const a of allocations) if (!a.deleted && a.envelopeId === env.id) sum += a.amount;
  for (const t of txs) if (!t.deleted && t.kind === 'expense' && t.envelopeId === env.id) sum -= t.amount;
  return sum;
}

// Money set aside in all live envelopes (never negative per envelope: an overspent envelope
// does not make free money appear).
export function reservedTotal(envelopes: readonly Envelope[], allocations: readonly Allocation[], txs: readonly Tx[]): number {
  let sum = 0;
  for (const e of live(envelopes)) sum += Math.max(0, envelopeBalance(e, allocations, txs));
  return sum;
}

export interface PlanLine {
  envelopeId: string;
  amount: number;
}

export interface Plan {
  lines: PlanLine[];
  free: number;
}

// Split an income: fixed amounts first (in the envelopes' order), then percents of the
// income; nothing is planned beyond what the income has, and a goal takes no more than it
// still needs. Amounts are rounded down to whole hundreds so the split reads cleanly.
export function planIncome(income: number, envelopes: readonly Envelope[], balances: ReadonlyMap<string, number>): Plan {
  const envs = live(envelopes).filter((e) => e.ruleMode !== 'none' && e.ruleValue > 0).sort((a, b) => a.order - b.order);
  let left = Math.max(0, Math.floor(income));
  const amounts = new Map<string, number>();
  const room = (e: Envelope) => (e.kind === 'goal' && e.target > 0 ? Math.max(0, e.target - (balances.get(e.id) ?? 0)) : Infinity);
  const give = (e: Envelope, want: number) => {
    const a = Math.min(left, room(e), Math.floor(want / 100) * 100);
    if (a <= 0) return;
    amounts.set(e.id, (amounts.get(e.id) ?? 0) + a);
    left -= a;
  };
  for (const e of envs) if (e.ruleMode === 'fixed') give(e, e.ruleValue);
  const base = Math.max(0, Math.floor(income));
  for (const e of envs) if (e.ruleMode === 'percent') give(e, (base * Math.min(100, e.ruleValue)) / 100);
  const lines = envs.filter((e) => amounts.has(e.id)).map((e) => ({ envelopeId: e.id, amount: amounts.get(e.id)! }));
  return { lines, free: left };
}

export function ruleLabel(e: Envelope): string {
  if (e.ruleMode === 'percent') return `${e.ruleValue} % каждого дохода`;
  if (e.ruleMode === 'fixed') return `${String(e.ruleValue).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸ с каждого дохода`;
  return 'Пополняется вручную';
}
