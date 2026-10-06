"use strict";
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const Sync = require("../sync-engine.js");

const clone = o => JSON.parse(JSON.stringify(o));
const tick = () => new Promise(r => setImmediate(r));

// ---------- minimal in-memory Firestore (compat-shaped) with offline queue ----------
const FV = {
  increment: n => ({ __t: "inc", n }),
  arrayUnion: (...v) => ({ __t: "union", v }),
  delete: () => ({ __t: "del" })
};
function applyData(old, patch, merge) {
  const out = merge && old ? clone(old) : {};
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v && v.__t === "inc") out[k] = (typeof out[k] === "number" ? out[k] : 0) + v.n;
    else if (v && v.__t === "union") {
      const arr = Array.isArray(out[k]) ? out[k].slice() : [];
      v.v.forEach(x => { if (!arr.some(y => JSON.stringify(y) === JSON.stringify(x))) arr.push(clone(x)); });
      out[k] = arr;
    } else if (v && v.__t === "del") delete out[k];
    else out[k] = clone(v);
  }
  return out;
}
class Server {
  constructor() { this.docs = new Map(); this.clients = new Set(); }
  apply(ops, origin) {
    const touched = [];
    for (const { path, data, merge } of ops) {
      this.docs.set(path, applyData(this.docs.get(path), data, merge));
      touched.push(path);
    }
    for (const c of this.clients) if (c !== origin && c.online) touched.forEach(p => c.receive(p, this.docs.get(p)));
  }
}
class Client {
  constructor(server) { this.server = server; this.online = true; this.cache = new Map(); this.queue = []; this.listeners = []; server.clients.add(this); }
  collection(path) {
    const self = this;
    return {
      doc: id => ({ id, path: path + "/" + id }),
      onSnapshot(opts, next) {
        const l = { path, next }; self.listeners.push(l);
        const docs = [];
        if (self.online) for (const [p, d] of self.server.docs) if (p.startsWith(path + "/") && p.indexOf("/", path.length + 1) < 0) { self.cache.set(p, clone(d)); }
        for (const [p, d] of self.cache) if (p.startsWith(path + "/")) docs.push({ p, d });
        self.emit(l, docs, false, !self.online);
        return () => { self.listeners = self.listeners.filter(x => x !== l); };
      }
    };
  }
  allDocs(path) {
    const out = [];
    for (const [p, d] of this.cache) if (p.startsWith(path + "/") && p.indexOf("/", path.length + 1) < 0) out.push({ p, d });
    return out;
  }
  emit(l, changed, pending, fromCache) {
    const all = this.allDocs(l.path);
    const wrap = x => ({ id: x.p.split("/").pop(), data: () => clone(x.d), metadata: { hasPendingWrites: !!pending } });
    l.next({
      metadata: { fromCache: !!fromCache },
      docs: all.map(x => ({ id: x.p.split("/").pop(), data: () => clone(x.d) })),
      docChanges: () => changed.map(x => Object.assign({ type: "added" }, { doc: wrap(x) }))
    });
  }
  notify(path, data, pending) {
    this.listeners.filter(l => path.startsWith(l.path + "/")).forEach(l => this.emit(l, [{ p: path, d: data }], pending, false));
  }
  receive(path, data) { this.cache.set(path, clone(data)); this.notify(path, data, false); }
  batch() {
    const ops = [], self = this;
    return {
      set(ref, data, opts) { ops.push({ path: ref.path, data: clone(data), merge: !!(opts && opts.merge) }); },
      commit() {
        return new Promise(res => {
          self.queue.push({ ops, res });
          ops.forEach(o => { const nv = applyData(self.cache.get(o.path), o.data, o.merge); self.cache.set(o.path, nv); self.notify(o.path, nv, true); });
          if (self.online) self.flush();
        });
      }
    };
  }
  flush() { const q = this.queue; this.queue = []; q.forEach(b => { this.server.apply(b.ops, this); b.res(); }); }
  setOnline(on) {
    this.online = on;
    if (!on) return;
    this.flush();
    for (const [p, d] of this.server.docs) {
      if (JSON.stringify(this.cache.get(p)) !== JSON.stringify(d)) this.cache.set(p, clone(d));
    }
    // back online: every listener gets a server-confirmed snapshot (metadata change), even if empty
    this.listeners.forEach(l => this.emit(l, this.allDocs(l.path), false, false));
  }
}

// ---------- a "device" = app state + engine ----------
let seq = 0;
function device(server, name, opts = {}) {
  const client = new Client(server);
  const d = {
    name, client, clock: opts.clock || 1000, storage: opts.storage || null,
    state: Object.assign({ ops: [], debts: [], closed: [], hex: "#EC3013", skin: 1, set: 1, lang: "ru" }, opts.state || {}),
    seed: !!opts.seed, applied: 0
  };
  d.engine = new Sync.Engine({
    db: client, uid: "u1", deviceId: opts.deviceId || name, fieldValue: FV,
    storage: d.storage || undefined,
    now: () => d.clock,
    setTimer: fn => { fn(); return 0; },
    clearTimer: () => {},
    isOnline: () => client.online,
    getState: () => d.state,
    isSeed: () => d.seed,
    onApply: (changes, o) => { d.applied++; Object.assign(d.state, Sync.reduce(d.state, changes, o)); d.seed = d.seed && !(o && o.reset) ? d.seed : false; }
  });
  d.start = () => d.engine.start();
  d.edit = fn => { d.clock += 10; fn(d.state); d.engine.push(); };
  return d;
}
const op = (id, extra) => Object.assign({ id, date: "05.10", cat: "Продукты", note: "n" + id, sum: -1000, pay: "card" }, extra);
const debt = (id, extra) => Object.assign({ id, who: "Айдос", note: "x", sum: 10000, mine: true, paid: 0, log: [] }, extra);
const BASE = 1700000000000;

test("an operation created on A shows up on B; B's demo seed is dropped", async () => {
  const s = new Server();
  const A = device(s, "A", { state: { ops: [op(BASE + 1)] } });
  A.start(); await tick();
  assert.ok(s.docs.has("users/u1/ops/" + (BASE + 1)));
  const B = device(s, "B", { seed: true, state: { ops: [op(1), op(2)] } });
  B.start(); await tick();
  assert.deepEqual(B.state.ops.map(o => o.id), [BASE + 1]);
});

test("a brand-new account on an untouched device starts empty and uploads no demo data", async () => {
  const s = new Server();
  const A = device(s, "A", { seed: true, state: { ops: [op(1), op(2)], debts: [debt(1)] } });
  A.start(); await tick();
  assert.equal(A.state.ops.length, 0);
  assert.equal(A.state.debts.length, 0);
  assert.ok(![...s.docs.keys()].some(k => k.includes("/ops/") || k.includes("/debts/")));
});

test("edits propagate live between two online devices", async () => {
  const s = new Server();
  const A = device(s, "A", { state: { ops: [op(BASE + 1)] } }); A.start(); await tick();
  const B = device(s, "B"); B.start(); await tick();
  A.edit(st => { st.ops[0] = Object.assign({}, st.ops[0], { note: "changed" }); });
  await tick();
  assert.equal(B.state.ops[0].note, "changed");
  B.edit(st => { st.ops.unshift(op(BASE + 2)); });
  await tick();
  assert.deepEqual(A.state.ops.map(o => o.id).sort(), [BASE + 1, BASE + 2].sort());
});

test("applying remote changes never triggers an echo write", async () => {
  const s = new Server();
  const A = device(s, "A", { state: { ops: [op(BASE + 1)] } }); A.start(); await tick();
  const B = device(s, "B"); B.start(); await tick();
  let writes = 0;
  const orig = B.client.batch.bind(B.client);
  B.client.batch = () => { writes++; return orig(); };
  A.edit(st => { st.ops[0] = Object.assign({}, st.ops[0], { note: "z" }); });
  await tick();
  B.engine.push(); B.engine.push();
  assert.equal(writes, 0);
});

test("offline edits on different records both survive reconnect", async () => {
  const s = new Server();
  const A = device(s, "A", { state: { ops: [op(BASE + 1), op(BASE + 2)] } }); A.start(); await tick();
  const B = device(s, "B"); B.start(); await tick();
  B.client.setOnline(false);
  A.edit(st => { st.ops[0] = Object.assign({}, st.ops[0], { note: "fromA" }); });
  B.edit(st => { const i = st.ops.findIndex(o => o.id === BASE + 2); st.ops[i] = Object.assign({}, st.ops[i], { note: "fromB" }); });
  B.client.setOnline(true); await tick();
  const noteOf = (d, id) => d.state.ops.find(o => o.id === id).note;
  for (const d of [A, B]) { assert.equal(noteOf(d, BASE + 1), "fromA"); assert.equal(noteOf(d, BASE + 2), "fromB"); }
});

test("same record edited on both devices: the later stamp wins everywhere, even if it arrives first", async () => {
  const s = new Server();
  const A = device(s, "A", { state: { ops: [op(BASE + 1)] } }); A.start(); await tick();
  const B = device(s, "B"); B.start(); await tick();
  A.client.setOnline(false);
  A.clock = 5000; A.edit(st => { st.ops[0] = Object.assign({}, st.ops[0], { note: "A-late" }); });   // stamp 5010
  B.clock = 2000; B.edit(st => { st.ops[0] = Object.assign({}, st.ops[0], { note: "B-early" }); });  // stamp 2010, reaches server first
  A.client.setOnline(true); await tick();   // A's write lands last on the server
  assert.equal(A.state.ops[0].note, "A-late");
  assert.equal(B.state.ops[0].note, "A-late");
  assert.equal(s.docs.get("users/u1/ops/" + (BASE + 1)).note, "A-late");
});

test("older write that arrives last is re-asserted by the newer device", async () => {
  const s = new Server();
  const A = device(s, "A", { state: { ops: [op(BASE + 1)] } }); A.start(); await tick();
  const B = device(s, "B"); B.start(); await tick();
  B.client.setOnline(false);
  B.clock = 9000; B.edit(st => { st.ops[0] = Object.assign({}, st.ops[0], { note: "B-late" }); });
  A.clock = 3000; A.edit(st => { st.ops[0] = Object.assign({}, st.ops[0], { note: "A-early" }); });   // server: A-early
  B.client.setOnline(true); await tick();                                                              // server: B-late
  A.client.setOnline(false); A.client.setOnline(true); await tick();
  for (const d of [A, B]) assert.equal(d.state.ops[0].note, "B-late");
});

test("a delete propagates and an offline device cannot resurrect the record", async () => {
  const s = new Server();
  const A = device(s, "A", { state: { ops: [op(BASE + 1), op(BASE + 2)] } }); A.start(); await tick();
  const B = device(s, "B"); B.start(); await tick();
  B.client.setOnline(false);
  A.edit(st => { st.ops = st.ops.filter(o => o.id !== BASE + 1); });
  B.client.setOnline(true); await tick();
  assert.deepEqual(B.state.ops.map(o => o.id), [BASE + 2]);
  assert.equal(s.docs.get("users/u1/ops/" + (BASE + 1))._del, true);
});

test("delete vs edit: whichever happened later wins", async () => {
  for (const [editFirst, expectAlive] of [[true, false], [false, true]]) {
    const s = new Server();
    const A = device(s, "A", { state: { ops: [op(BASE + 1)] } }); A.start(); await tick();
    const B = device(s, "B"); B.start(); await tick();
    B.client.setOnline(false);
    if (editFirst) {
      B.clock = 2000; B.edit(st => { st.ops[0] = Object.assign({}, st.ops[0], { note: "edit" }); });
      A.clock = 3000; A.edit(st => { st.ops = []; });
    } else {
      A.clock = 3000; A.edit(st => { st.ops = []; });
      B.clock = 4000; B.edit(st => { st.ops[0] = Object.assign({}, st.ops[0], { note: "edit" }); });
    }
    B.client.setOnline(true); await tick();
    A.client.setOnline(false); A.client.setOnline(true); await tick();
    assert.equal(A.state.ops.length, expectAlive ? 1 : 0, "A editFirst=" + editFirst);
    assert.equal(B.state.ops.length, expectAlive ? 1 : 0, "B editFirst=" + editFirst);
  }
});

test("concurrent repayments from two devices are both counted", async () => {
  const s = new Server();
  const A = device(s, "A", { state: { debts: [debt(BASE + 7)] } }); A.start(); await tick();
  const B = device(s, "B"); B.start(); await tick();
  B.client.setOnline(false);
  const repay = (st, sum, id) => { const d = st.debts[0]; st.debts[0] = Object.assign({}, d, { paid: d.paid + sum, log: d.log.concat([{ sum, date: "05.10", id }]) }); };
  A.edit(st => repay(st, 5000, "a1"));
  B.edit(st => repay(st, 3000, "b1"));
  B.client.setOnline(true); await tick();
  A.client.setOnline(false); A.client.setOnline(true); await tick();
  for (const d of [A, B]) {
    assert.equal(d.state.debts[0].paid, 8000, d.name);
    assert.equal(d.state.debts[0].log.length, 2, d.name);
  }
  assert.equal(s.docs.get("users/u1/debts/" + (BASE + 7)).paid, 8000);
});

test("closing a debt moves it between lists on the other device", async () => {
  const s = new Server();
  const A = device(s, "A", { state: { debts: [debt(BASE + 7)] } }); A.start(); await tick();
  const B = device(s, "B"); B.start(); await tick();
  A.edit(st => { const d = st.debts.shift(); st.closed.unshift(Object.assign({}, d, { paid: d.sum, closedAt: "05.10", reason: "r" })); });
  await tick();
  assert.equal(B.state.debts.length, 0);
  assert.equal(B.state.closed.length, 1);
  assert.equal(B.state.closed[0].paid, 10000);
  assert.equal(B.state.closed[0].closed, undefined);
});

test("settings sync, but the device-local theme flag does not", async () => {
  const s = new Server();
  const A = device(s, "A", { state: { ops: [op(BASE + 1)], lang: "kz", hex: "#112233", light: true } }); A.start(); await tick();
  const B = device(s, "B", { state: { light: false } }); B.start(); await tick();
  assert.equal(B.state.lang, "kz");
  assert.equal(B.state.hex, "#112233");
  assert.equal(B.state.light, false);
  assert.ok(!("light" in s.docs.get("users/u1/meta/settings")));
});

test("a device that never synced waits for the server and does not push while offline", async () => {
  const s = new Server();
  const A = device(s, "A", { state: { ops: [op(BASE + 1)] } }); A.start(); await tick();
  const B = device(s, "B", { state: { ops: [op(BASE + 9)] } });
  B.client.setOnline(false);
  B.start(); await tick();
  assert.equal(B.engine.synced, false);
  assert.ok(!s.docs.has("users/u1/ops/" + (BASE + 9)));
  B.client.setOnline(true); await tick();
  assert.equal(B.engine.synced, true);
  const ids = B.state.ops.map(o => o.id).sort();
  assert.deepEqual(ids, [BASE + 1, BASE + 9].sort());            // real offline-created data is kept and merged
  assert.ok(s.docs.has("users/u1/ops/" + (BASE + 9)));
});

test("invalid remote data is ignored, not applied", async () => {
  const s = new Server();
  s.docs.set("users/u1/ops/5", { id: 5, date: "05.10", cat: "x", note: "", sum: "NaN", pay: "card", _u: 10, _d: "evil" });
  s.docs.set("users/u1/ops/6", { id: 6, date: "garbage", cat: "x", note: "", sum: 5, pay: "card", _u: 10, _d: "evil" });
  s.docs.set("users/u1/ops/7", { id: 7, date: "05.10", cat: "ok", note: "", sum: 5, pay: "card", _u: 10, _d: "evil" });
  const A = device(s, "A"); A.start(); await tick();
  assert.deepEqual(A.state.ops.map(o => o.id), [7]);
});

test("sync state persists: offline edits made before a restart are pushed afterwards", async () => {
  const store = {}; const storage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  const s = new Server();
  const A1 = device(s, "A", { storage, state: { ops: [op(BASE + 1)] } }); A1.start(); await tick();
  A1.engine.stop();
  const state = clone(A1.state);
  state.ops.push(op(BASE + 2));                                  // edit made while the app was closed / engine off
  const A2 = device(s, "A", { storage, state });
  A2.start(); await tick();
  assert.equal(A2.engine.synced, true);                          // no second "fresh device" reconcile
  A2.engine.push(); await tick();
  assert.ok(s.docs.has("users/u1/ops/" + (BASE + 2)));
});

test("reduce(): new remote ops go to the front, existing order is kept, settings are replaced", () => {
  const st = { ops: [op(3), op(1)], debts: [], closed: [] };
  const out = Sync.reduce(st, [
    { key: "ops/9", data: op(9) }, { key: "ops/1", del: true },
    { key: "meta/settings", data: { lang: "en" } }
  ], {});
  assert.deepEqual(out.ops.map(o => o.id), [9, 3]);
  assert.equal(out.lang, "en");
  assert.ok("eCats" in out && out.eCats === undefined);
});

test("mergeDebt(): counters add up, logs union, closed is sticky", () => {
  const base = debt(1, { paid: 1000, log: [{ sum: 1000, date: "01.10", id: "x" }] });
  const local = Object.assign({}, base, { paid: 1500, log: base.log.concat([{ sum: 500, date: "02.10", id: "l" }]) });
  const remote = Object.assign({}, base, { paid: 3000, log: base.log.concat([{ sum: 2000, date: "02.10", id: "r" }]) });
  const m = Sync.mergeDebt(base, local, remote);
  assert.equal(m.paid, 3500);
  assert.deepEqual(m.log.map(e => e.id).sort(), ["l", "r", "x"]);
});

// ---------- randomized convergence ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

for (const seed of [1, 7, 42, 99, 2024, 31337]) {
  test("fuzz: 3 devices with random offline edits converge (seed " + seed + ")", async () => {
    const rand = rng(seed), s = new Server();
    const devs = ["A", "B", "C"].map((n, i) => device(s, n, { clock: 1000 * (i + 1), state: i === 0 ? { ops: [op(BASE + 1), op(BASE + 2), op(BASE + 3)], debts: [debt(BASE + 50)] } : {} }));
    for (const d of devs) { d.start(); await tick(); }
    let nextId = BASE + 100, rid = 0;
    for (let step = 0; step < 120; step++) {
      const d = devs[Math.floor(rand() * devs.length)];
      const r = rand();
      if (r < 0.12) { d.client.setOnline(!d.client.online); await tick(); }
      else if (r < 0.40) d.edit(st => { st.ops.unshift(op(nextId++, { note: d.name + step })); });
      else if (r < 0.62 && d.state.ops.length) d.edit(st => { const i = Math.floor(rand() * st.ops.length); st.ops[i] = Object.assign({}, st.ops[i], { note: d.name + "e" + step }); });
      else if (r < 0.78 && d.state.ops.length) d.edit(st => { st.ops.splice(Math.floor(rand() * st.ops.length), 1); });
      else if (r < 0.92 && d.state.debts.length) d.edit(st => { const x = st.debts[0]; if (x.paid >= x.sum) return; const sum = 100; st.debts[0] = Object.assign({}, x, { paid: x.paid + sum, log: x.log.concat([{ sum, date: "05.10", id: d.name + (rid++) }]) }); });
      else d.edit(st => { st.lang = ["ru", "kz", "en"][Math.floor(rand() * 3)]; });
      await tick();
    }
    for (const d of devs) { d.client.setOnline(true); await tick(); }
    for (let round = 0; round < 4; round++) for (const d of devs) { d.client.setOnline(false); d.client.setOnline(true); await tick(); }
    const view = d => JSON.stringify({
      ops: d.state.ops.map(o => [o.id, o.note]).sort((a, b) => a[0] - b[0]),
      debts: d.state.debts.concat(d.state.closed).map(x => [x.id, x.paid, x.log.length]).sort(),
      lang: d.state.lang
    });
    assert.equal(view(devs[0]), view(devs[1]), "A vs B");
    assert.equal(view(devs[0]), view(devs[2]), "A vs C");
    // the debt's paid amount must equal the number of distinct repayments, none lost or double counted
    const x = devs[0].state.debts.concat(devs[0].state.closed).find(y => y.id === BASE + 50);
    assert.equal(x.paid, x.log.reduce((a, e) => a + e.sum, 0), "paid equals the sum of the log");
  });
}

// ───────────── v2 fields: ts, due, budget, opening balances, category icons ─────────────

test("v2: operation time, debt due date/timestamp, budget, balances and icons reach the other device", async () => {
  const s = new Server();
  const A = device(s, "A", { state: {
    ops: [op(BASE + 1, { ts: BASE + 5 })], debts: [debt(BASE + 2, { due: "2026-10-20", ts: BASE + 9, log: [{ sum: 5, date: "01.10", ts: BASE + 3, id: "r1" }], paid: 5 })],
    budget: 250000, openCash: 5000, openCard: 0, catIcons: { "Кафе": "coffee" }
  } });
  A.start(); await tick();
  const B = device(s, "B"); B.start(); await tick();
  assert.equal(B.state.ops[0].ts, BASE + 5);
  assert.equal(B.state.debts[0].due, "2026-10-20");
  assert.equal(B.state.debts[0].ts, BASE + 9);
  assert.equal(B.state.debts[0].log[0].ts, BASE + 3);
  assert.equal(B.state.budget, 250000);
  assert.equal(B.state.openCash, 5000);
  assert.equal(B.state.openCard, 0, "an explicit zero balance syncs too");
  assert.deepEqual(B.state.catIcons, { "Кафе": "coffee" });
  assert.equal(s.docs.get("users/u1/ops/" + (BASE + 1)).ts, BASE + 5);
});

test("v2: clearing the budget removes it on every device (settings are replaced, not merged)", async () => {
  const s = new Server();
  const A = device(s, "A", { state: { ops: [op(BASE + 1)], budget: 100000 } }); A.start(); await tick();
  const B = device(s, "B"); B.start(); await tick();
  assert.equal(B.state.budget, 100000);
  A.edit(st => { st.budget = undefined; });
  await tick();
  assert.equal("budget" in s.docs.get("users/u1/meta/settings"), false);
  assert.equal(B.state.budget, undefined);
});

test("v2: a debt's due date is edited field-wise, and removing it propagates", async () => {
  const s = new Server();
  const A = device(s, "A", { state: { debts: [debt(BASE + 7, { due: "2026-10-20" })] } }); A.start(); await tick();
  const B = device(s, "B"); B.start(); await tick();
  A.client.setOnline(false); B.client.setOnline(false);
  A.edit(st => { st.debts[0] = Object.assign({}, st.debts[0], { due: "2026-11-01" }); });
  B.edit(st => { st.debts[0] = Object.assign({}, st.debts[0], { who: "Айдос Н." }); });
  B.client.setOnline(true); await tick();
  A.client.setOnline(true); await tick();
  for (let i = 0; i < 3; i++) { A.client.setOnline(false); A.client.setOnline(true); B.client.setOnline(false); B.client.setOnline(true); await tick(); }
  for (const d of [A, B]) {
    assert.equal(d.state.debts[0].due, "2026-11-01", d.name + ": due edit kept");
    assert.equal(d.state.debts[0].who, "Айдос Н.", d.name + ": name edit kept");
  }
  A.edit(st => { const x = Object.assign({}, st.debts[0]); delete x.due; st.debts[0] = x; });
  await tick();
  assert.equal(B.state.debts[0].due, undefined, "no due date any more");
  assert.equal("due" in s.docs.get("users/u1/debts/" + (BASE + 7)), false);
});

test("v2: malformed new fields from the cloud are dropped by clean()", () => {
  assert.equal(Sync.clean("ops", { id: 1, date: "01.10", cat: "A", note: "", sum: -5, pay: "card", ts: "now" }).ts, undefined);
  assert.equal(Sync.clean("ops", { id: 1, date: "01.10", cat: "A", note: "", sum: -5, pay: "card", ts: -4 }).ts, undefined);
  assert.equal(Sync.clean("ops", { id: 1, date: "01.10", cat: "A", note: "", sum: -5, pay: "card", ts: BASE }).ts, BASE);
  assert.equal(Sync.clean("debts", { id: 2, who: "A", sum: 5, mine: true, due: "tomorrow" }).due, undefined);
  assert.equal(Sync.clean("debts", { id: 2, who: "A", sum: 5, mine: true, due: "2026-10-20" }).due, "2026-10-20");
  const st = Sync.clean("meta", { budget: -5, openCash: "x", openCard: 12.6, catIcons: { a: "ok-icon", b: "<bad>", __proto__: "x" } });
  assert.equal(st.budget, undefined);
  assert.equal(st.openCash, undefined);
  assert.equal(st.openCard, 13);
  assert.deepEqual(st.catIcons, { a: "ok-icon" });
  assert.ok(Sync.SETTINGS_KEYS.indexOf("budget") >= 0 && Sync.SETTINGS_KEYS.indexOf("catIcons") >= 0);
});
