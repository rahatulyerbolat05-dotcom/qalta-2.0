import { DEFAULT_CATS } from './logic.js';
import type { Tx } from './daily.ts';
import { categoryUsage } from './daily.ts';

export const CATEGORIES: Record<'expense' | 'income', string[]> = {
  expense: [...(DEFAULT_CATS as { expense: string[] }).expense],
  income: ['Гонорар', ...(DEFAULT_CATS as { income: string[] }).income],
};

// Chip order: what the phrase suggests, then what this person uses most, then the rest.
export function orderedCategories(kind: 'expense' | 'income', txs: readonly Tx[], suggested: readonly string[] = []): string[] {
  const usage = categoryUsage(txs, kind);
  const base = CATEGORIES[kind];
  const byUse = [...base].sort((a, b) => (usage.get(b) ?? 0) - (usage.get(a) ?? 0));
  const extra = [...usage.keys()].filter((c) => !base.includes(c)); // categories that came from another device
  return [...new Set([...suggested.filter((c) => base.includes(c) || usage.has(c)), ...byUse, ...extra])];
}
