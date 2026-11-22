// Record-by-record merge for sync between devices: the later update wins, ties go to the
// larger device id so every device settles on the same copy. A deletion is a record too
// (deleted: true), so an old copy from an offline device cannot bring a deleted entry back.
import type { Stamped } from './daily.ts';

export type Synced<T extends Stamped> = T & { deviceId?: string };

export function newer<T extends Stamped>(a: Synced<T>, b: Synced<T> | undefined): boolean {
  if (!b) return true;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return (a.deviceId ?? '') > (b.deviceId ?? '');
}

// Returns the records from `incoming` that should replace or add to `local`.
export function pickIncoming<T extends Stamped>(local: ReadonlyMap<string, Synced<T>>, incoming: readonly Synced<T>[]): Synced<T>[] {
  const out: Synced<T>[] = [];
  for (const r of incoming) if (newer(r, local.get(r.id))) out.push(r);
  return out;
}

// Local records the cloud has not seen yet: changed after the last successful push.
export function pending<T extends Stamped>(all: readonly T[], watermark: number): T[] {
  return all.filter((r) => r.updatedAt > watermark);
}
