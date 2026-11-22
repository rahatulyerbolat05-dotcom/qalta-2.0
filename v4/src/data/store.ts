// Local data. Everything is held in memory for instant reads and written through to
// IndexedDB (Dexie). If IndexedDB is refused (private mode, sandboxed frame), the app keeps
// working in memory and says so on screen instead of failing.
//
// Every change stamps the record (updatedAt, deviceId); deletions stay as records with
// deleted: true. That is what lets sync.ts merge devices record by record.
import Dexie, { type Table } from 'dexie';
import type { Account, Stamped, Tx } from '../domain/daily.ts';
import { dayFigure, ymd } from '../domain/daily.ts';
import { pickIncoming, type Synced } from '../domain/merge.ts';
import { reservedTotal, type Allocation, type Envelope } from '../domain/envelopes.ts';

export interface Settings extends Stamped {
  until: string; // 'YYYY-MM-DD'
}

export interface User {
  uid: string;
  name: string;
  email: string;
}

export type SyncStatus = 'off' | 'connecting' | 'on' | 'offline' | 'error';

export interface State {
  ready: boolean;
  persistent: boolean;
  accounts: Account[]; // live, by order
  txs: Tx[]; // live, newest first
  envelopes: Envelope[]; // live, by order
  allocations: Allocation[]; // live
  settings: Settings;
  user: User | null;
  sync: SyncStatus;
  syncNote: string;
}

type KV = { key: string; value: unknown };

class QaltaDB extends Dexie {
  accounts!: Table<Synced<Account>, string>;
  txs!: Table<Synced<Tx>, string>;
  envelopes!: Table<Synced<Envelope>, string>;
  allocations!: Table<Synced<Allocation>, string>;
  kv!: Table<KV, string>;
  constructor() {
    super('qalta4');
    this.version(1).stores({ accounts: 'id, order', txs: 'id, at, accountId', kv: 'key' });
    this.version(2).stores({ envelopes: 'id, order', allocations: 'id, envelopeId' });
  }
}

const DAY = 86_400_000;
const BOOT_KEY = 'qalta4:boot';

export function defaultUntil(now = Date.now()): string {
  return ymd(now + 13 * DAY); // two weeks including today
}

export function newId(): string {
  const t = Date.now().toString(36).padStart(9, '0');
  const r = crypto.getRandomValues(new Uint32Array(2));
  return t + r[0].toString(36) + r[1].toString(36);
}

function deviceId(): string {
  try {
    let id = localStorage.getItem('qalta4:device');
    if (!id) {
      id = newId();
      localStorage.setItem('qalta4:device', id);
    }
    return id;
  } catch {
    return 'mem-' + newId();
  }
}

type Listener = (s: State) => void;
export type Collection = 'accounts' | 'txs' | 'envelopes' | 'allocations' | 'settings';
export const COLLECTIONS: Collection[] = ['accounts', 'txs', 'envelopes', 'allocations', 'settings'];
type LocalChange = (c: Collection, records: Array<Synced<Stamped>>) => void;

class Store {
  private db: QaltaDB | null = null;
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel | null = null;
  private accounts = new Map<string, Synced<Account>>();
  private txs = new Map<string, Synced<Tx>>();
  private envelopes = new Map<string, Synced<Envelope>>();
  private allocations = new Map<string, Synced<Allocation>>();
  private settingsRec: Synced<Settings> = { id: 'settings', until: defaultUntil(), updatedAt: 0 };
  private onLocal: LocalChange | null = null;
  readonly device = deviceId();

  state: State = { ready: false, persistent: true, accounts: [], txs: [], envelopes: [], allocations: [], settings: this.settingsRec, user: null, sync: 'off', syncNote: '' };

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // sync.ts listens here for records to push.
  onLocalChange(fn: LocalChange | null) {
    this.onLocal = fn;
  }

  private rebuild(extra: Partial<State> = {}) {
    const accounts = [...this.accounts.values()].filter((a) => !a.deleted).sort((a, b) => a.order - b.order);
    const txs = [...this.txs.values()].filter((t) => !t.deleted).sort((a, b) => b.at - a.at || b.createdAt - a.createdAt);
    const envelopes = [...this.envelopes.values()].filter((e) => !e.deleted).sort((a, b) => a.order - b.order);
    const allocations = [...this.allocations.values()].filter((a) => !a.deleted);
    this.state = { ...this.state, accounts, txs, envelopes, allocations, settings: this.settingsRec, ...extra };
    this.writeBoot();
    for (const fn of this.listeners) fn(this.state);
  }

  set(extra: Partial<State>) {
    this.state = { ...this.state, ...extra };
    for (const fn of this.listeners) fn(this.state);
  }

  // The next launch paints this before any script has loaded.
  private writeBoot() {
    const s = this.state;
    if (!s.ready) return;
    try {
      if (!s.accounts.length) return localStorage.removeItem(BOOT_KEY);
      const f = dayFigure(s.accounts, s.txs, Date.now(), s.settings.until, reservedTotal(s.envelopes, s.allocations, s.txs));
      localStorage.setItem(BOOT_KEY, JSON.stringify({ left: f.left, allowance: f.allowance, spent: f.spent, until: s.settings.until, day: ymd(Date.now()) }));
    } catch {
      /* storage refused: the next launch shows the plain skeleton */
    }
  }

  async open() {
    try {
      const db = new QaltaDB();
      await db.open();
      await this.load(db);
      this.db = db;
      this.rebuild({ ready: true, persistent: true });
      try {
        this.channel = new BroadcastChannel('qalta4');
        this.channel.onmessage = () => void this.load(db).then(() => this.rebuild());
      } catch {
        /* no cross-tab updates in this browser */
      }
    } catch {
      this.rebuild({ ready: true, persistent: false });
    }
  }

  private async load(db: QaltaDB) {
    const [accounts, txs, envelopes, allocations, settings] = await Promise.all([db.accounts.toArray(), db.txs.toArray(), db.envelopes.toArray(), db.allocations.toArray(), db.kv.get('settings')]);
    this.accounts = new Map(accounts.map((a) => [a.id, a]));
    this.txs = new Map(txs.map((t) => [t.id, t]));
    this.envelopes = new Map(envelopes.map((e) => [e.id, e]));
    this.allocations = new Map(allocations.map((a) => [a.id, a]));
    const s = settings?.value as Synced<Settings> | undefined;
    if (s && typeof s.until === 'string') this.settingsRec = s;
  }

  async kvGet<T>(key: string): Promise<T | undefined> {
    try {
      return (await this.db?.kv.get(key))?.value as T | undefined;
    } catch {
      return undefined;
    }
  }

  async kvSet(key: string, value: unknown) {
    try {
      await this.db?.kv.put({ key, value });
    } catch {
      /* best effort */
    }
  }

  private async persist(work: (db: QaltaDB) => Promise<unknown>) {
    if (!this.db) return;
    try {
      await this.db.transaction('rw', [this.db.accounts, this.db.txs, this.db.envelopes, this.db.allocations, this.db.kv], () => work(this.db!));
      this.channel?.postMessage('changed');
    } catch {
      this.set({ persistent: false });
    }
  }

  private stamp<T extends Stamped>(rec: T, prev?: Stamped): Synced<T> {
    const updatedAt = Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1);
    return { ...rec, updatedAt, deviceId: this.device };
  }

  private commitAccounts(recs: Array<Synced<Account>>) {
    for (const r of recs) this.accounts.set(r.id, r);
    this.rebuild();
    void this.persist((db) => db.accounts.bulkPut(recs));
    this.onLocal?.('accounts', recs);
  }

  private commitTxs(recs: Array<Synced<Tx>>) {
    for (const r of recs) this.txs.set(r.id, r);
    this.rebuild();
    void this.persist((db) => db.txs.bulkPut(recs));
    this.onLocal?.('txs', recs);
  }

  private commitEnvelopes(recs: Array<Synced<Envelope>>) {
    for (const r of recs) this.envelopes.set(r.id, r);
    this.rebuild();
    void this.persist((db) => db.envelopes.bulkPut(recs));
    this.onLocal?.('envelopes', recs);
  }

  private commitAllocations(recs: Array<Synced<Allocation>>) {
    if (!recs.length) return;
    for (const r of recs) this.allocations.set(r.id, r);
    this.rebuild();
    void this.persist((db) => db.allocations.bulkPut(recs));
    this.onLocal?.('allocations', recs);
  }

  // ───── actions ─────

  setup(card: number, cash: number, until: string) {
    const now = Date.now();
    const accs: Array<Synced<Account>> = [
      this.stamp({ id: newId(), name: 'Карта', kind: 'card', openingAmount: card, openingAt: now, order: 0, updatedAt: 0 } as Account),
      this.stamp({ id: newId(), name: 'Наличные', kind: 'cash', openingAmount: cash, openingAt: now, order: 1, updatedAt: 0 } as Account),
    ];
    this.setUntil(until);
    this.commitAccounts(accs);
  }

  setUntil(until: string) {
    this.settingsRec = this.stamp({ ...this.settingsRec, until }, this.settingsRec);
    this.rebuild();
    const rec = this.settingsRec;
    void this.persist((db) => db.kv.put({ key: 'settings', value: rec }));
    this.onLocal?.('settings', [rec]);
  }

  // "I have X on this account now": moves the anchor, earlier operations stay in history.
  adjustAccount(id: string, amount: number) {
    const a = this.accounts.get(id);
    if (!a) return;
    this.commitAccounts([this.stamp({ ...a, openingAmount: amount, openingAt: Date.now() }, a)]);
  }

  addTx(input: Omit<Tx, 'id' | 'createdAt' | 'updatedAt'>): Tx {
    const tx = this.stamp({ ...input, id: newId(), createdAt: Date.now(), updatedAt: 0 } as Tx);
    this.commitTxs([tx]);
    return tx;
  }

  updateTx(id: string, patch: Partial<Omit<Tx, 'id' | 'createdAt' | 'updatedAt'>>) {
    const t = this.txs.get(id);
    if (!t || t.deleted) return;
    this.commitTxs([this.stamp({ ...t, ...patch }, t)]);
  }

  removeTx(id: string): Tx | undefined {
    const t = this.txs.get(id);
    if (!t || t.deleted) return undefined;
    this.commitTxs([this.stamp({ ...t, deleted: true }, t)]);
    return t;
  }

  restoreTx(tx: Tx) {
    const cur = this.txs.get(tx.id);
    this.commitTxs([this.stamp({ ...tx, deleted: false }, cur)]);
  }

  // ───── envelopes ─────

  saveEnvelope(e: Omit<Envelope, 'id' | 'updatedAt' | 'order'> & { id?: string }): Envelope {
    const prev = e.id ? this.envelopes.get(e.id) : undefined;
    const order = prev?.order ?? Math.max(-1, ...[...this.envelopes.values()].map((x) => x.order)) + 1;
    const rec = this.stamp({ ...prev, ...e, id: e.id ?? newId(), order, updatedAt: 0 } as Envelope, prev);
    this.commitEnvelopes([rec]);
    return rec;
  }

  // Deleting an envelope returns its money to free money: its movements are deleted with it.
  removeEnvelope(id: string) {
    const e = this.envelopes.get(id);
    if (!e) return;
    const allocs = [...this.allocations.values()].filter((a) => a.envelopeId === id && !a.deleted).map((a) => this.stamp({ ...a, deleted: true }, a));
    this.commitEnvelopes([this.stamp({ ...e, deleted: true }, e)]);
    this.commitAllocations(allocs);
  }

  // Put money in (+) or take it out (−); one record per movement.
  moveEnvelope(envelopeId: string, amount: number, note = '', incomeTxId = ''): Allocation {
    const a = this.stamp({ id: newId(), envelopeId, amount, at: Date.now(), incomeTxId, note, updatedAt: 0 } as Allocation);
    this.commitAllocations([a]);
    return a;
  }

  allocate(incomeTxId: string, lines: Array<{ envelopeId: string; amount: number }>): Allocation[] {
    const at = Date.now();
    const recs = lines.filter((l) => l.amount > 0).map((l) => this.stamp({ id: newId(), envelopeId: l.envelopeId, amount: l.amount, at, incomeTxId, note: '', updatedAt: 0 } as Allocation));
    this.commitAllocations(recs);
    return recs;
  }

  undoAllocations(ids: string[]) {
    this.commitAllocations(ids.map((id) => this.allocations.get(id)).filter((a): a is Synced<Allocation> => !!a && !a.deleted).map((a) => this.stamp({ ...a, deleted: true }, a)));
  }

  // ───── sync support ─────

  all(c: Collection): Array<Synced<Stamped>> {
    if (c === 'accounts') return [...this.accounts.values()];
    if (c === 'txs') return [...this.txs.values()];
    if (c === 'envelopes') return [...this.envelopes.values()];
    if (c === 'allocations') return [...this.allocations.values()];
    return [this.settingsRec];
  }

  applyRemote(c: Collection, incoming: Array<Synced<Stamped>>): number {
    if (c === 'settings') {
      const [s] = incoming as Array<Synced<Settings>>;
      if (!s || !pickIncoming(new Map([['settings', this.settingsRec]]), [s]).length) return 0;
      this.settingsRec = s;
      this.rebuild();
      void this.persist((db) => db.kv.put({ key: 'settings', value: s }));
      return 1;
    }
    const map = { accounts: this.accounts, txs: this.txs, envelopes: this.envelopes, allocations: this.allocations }[c] as Map<string, Synced<Stamped>>;
    const take = pickIncoming(map, incoming);
    if (!take.length) return 0;
    for (const r of take) map.set(r.id, r);
    this.rebuild();
    void this.persist((db) => (db[c] as unknown as Table<Synced<Stamped>, string>).bulkPut(take));
    return take.length;
  }

  // Signing into a different Google account on this device: keep a copy, then start clean.
  async resetForOtherAccount() {
    try {
      localStorage.setItem('qalta4:backup-before-switch', JSON.stringify({ at: Date.now(), accounts: this.all('accounts'), txs: this.all('txs'), envelopes: this.all('envelopes'), allocations: this.all('allocations'), settings: this.settingsRec }));
    } catch {
      throw new Error('backup-failed');
    }
    this.accounts.clear();
    this.txs.clear();
    this.envelopes.clear();
    this.allocations.clear();
    this.settingsRec = { id: 'settings', until: defaultUntil(), updatedAt: 0 };
    await this.persist(async (db) => {
      await db.accounts.clear();
      await db.txs.clear();
      await db.envelopes.clear();
      await db.allocations.clear();
      await db.kv.delete('settings');
    });
    this.rebuild();
  }
}

export const store = new Store();
