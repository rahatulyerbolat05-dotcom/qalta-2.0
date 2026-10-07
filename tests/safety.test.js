// node --test tests/safety.test.js — what the independent review found, as behaviour of the real component:
// writes that fail, tabs that overwrite each other, undo that overwrites newer data, imports and account
// switches that destroy data, edits that vanish, focus that is lost.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { load, makeStorage, type } = require("./helpers/harness.js");

const wait = ms => new Promise(r => setTimeout(r, ms));
// A storage that can be told to refuse writes (all of them, or only some keys) and counts the writes per key.
function flaky(initial) {
  const storage = makeStorage(initial);
  const real = storage.setItem;
  storage.failing = false; storage.failKeys = null; storage.writes = {};
  storage.setItem = (k, v) => {
    if (storage.failing && (!storage.failKeys || storage.failKeys.indexOf(k) >= 0)) throw new Error("QuotaExceededError");
    storage.writes[k] = (storage.writes[k] || 0) + 1;
    return real(k, v);
  };
  return storage;
}
function app(storage) { const h = load({ storage: storage || flaky() }); h.vals = () => h.c.renderVals(); return h; }
const op = (id, extra) => Object.assign({ id, date: "01.10", cat: "Кафе", note: "", sum: -100, pay: "card" }, extra);
const debt = (id, extra) => Object.assign({ id, who: "Айдос", note: "", sum: 10000, mine: true, paid: 0, log: [] }, extra);
const importFile = async (c, text) => { c.onImportFile({ target: { files: [{ size: text.length, text }], value: "x" } }); await wait(20); };

// ───────────────────────────── storage ─────────────────────────────

test("a failed write is reported, retried, and flushed when the page hides", async () => {
  const storage = flaky();
  const h = app(storage), c = h.c;
  storage.failing = true;
  c.setState({ budget: 5000 });
  c.componentDidUpdate();
  await wait(300);
  assert.equal(c.state.storageError, true);
  assert.equal(h.vals().hasBanner, true, "the warning belongs to the shell, not to two of the four screens");
  assert.ok(c._retryT, "a retry is scheduled");
  storage.failing = false;
  c.flush();                                           // the page is hiding: unsaved data goes out now
  assert.equal(JSON.parse(storage.getItem("qalta-proto-v1")).budget, 5000);
  assert.equal(c.state.storageError, false);
});

test("a theme change writes only the preferences, never the data blob", async () => {
  const storage = flaky();
  const c = app(storage).c;
  const data0 = storage.writes["qalta-proto-v1"], ui0 = storage.writes["qalta-ui-v1"] || 0;
  c.setState({ theme: "dark" }); c.componentDidUpdate();
  await wait(300);
  assert.equal(storage.writes["qalta-proto-v1"], data0);
  assert.equal(storage.writes["qalta-ui-v1"], ui0 + 1);
});

test("a change saved by another tab is adopted, and this tab never writes an older copy over it", async () => {
  const storage = flaky();
  const c = app(storage).c;
  c.setState({ budget: 7000, openCash: 100 }); c.persistNow();
  // another tab saves different data into the shared storage
  const other = JSON.parse(storage.getItem("qalta-proto-v1"));
  delete other.budget; other.ops = [op(1)];
  const raw = JSON.stringify(other);
  storage.setItem("qalta-proto-v1", raw);
  c.onStorage({ key: "qalta-proto-v1", newValue: raw, storageArea: storage });
  assert.equal(c.state.budget, undefined, "what the other tab removed is removed here too");
  assert.equal(c.state.ops.length, 1);
  assert.equal(c.dirty().data, false, "adopted, not edited: nothing to write back");
  // this tab only changes the theme afterwards: the other tab's data stays
  const writes = storage.writes["qalta-proto-v1"];
  c.setState({ theme: "dark" }); c.componentDidUpdate();
  await wait(300);
  assert.equal(storage.writes["qalta-proto-v1"], writes);
  assert.equal(JSON.parse(storage.getItem("qalta-proto-v1")).ops.length, 1);
  // a tab with an unsaved change of its own keeps it: its write is imminent
  c.setState({ budget: 1 });
  c.onStorage({ key: "qalta-proto-v1", newValue: raw, storageArea: storage });
  assert.equal(c.state.budget, 1);
  // preferences travel between tabs too
  c.persistNow();
  c.onStorage({ key: "qalta-ui-v1", newValue: JSON.stringify({ theme: "light", lastPay: "cash", tips: {} }), storageArea: storage });
  assert.equal(c.state.theme, "light");
  assert.equal(c.state.lastPay, "cash");
});

test("unmounting inside the debounce window does not drop the last change", () => {
  const storage = flaky();
  const c = app(storage).c;
  c.setState({ budget: 321 }); c.componentDidUpdate();   // debounce armed, not fired yet
  c.componentWillUnmount();
  assert.equal(JSON.parse(storage.getItem("qalta-proto-v1")).budget, 321);
});

test("a new install gets an identity once, and a reload keeps it", () => {
  const storage = flaky();
  const a = app(storage);
  const gen = a.c.state.gen;
  assert.match(gen, /^[A-Za-z0-9_-]{8,40}$/);
  assert.equal(JSON.parse(storage.getItem("qalta-proto-v1")).gen, gen);
  assert.equal(app(storage).c.state.gen, gen);
});

test("unreadable data is kept aside, reported on every screen, and the app starts empty", () => {
  const storage = flaky({ "qalta-proto-v1": "{broken" });
  const h = app(storage);
  assert.equal(storage.getItem("qalta-proto-v1.corrupt"), "{broken");
  assert.equal(h.c.state.readFail, "kept");
  const v = h.vals();
  assert.equal(v.hasReadBanner, true);
  assert.match(v.readBanner, /не удалось прочитать/);
  v.dismissRead();
  assert.equal(h.vals().hasReadBanner, false);
  const noRoom = flaky({ "qalta-proto-v1": "{broken" });
  noRoom.failing = true; noRoom.failKeys = ["qalta-proto-v1.corrupt"];
  assert.equal(app(noRoom).c.state.readFail, "lost", "if the copy cannot be kept either, the person is told so");
});

test("migrating an untouched demo keeps the person's settings, and the seed marker goes only after the copy is stored", () => {
  const demoOps = [{ id: 1, date: "06.10", cat: "Продукты", note: "магнит у дома · карта", sum: -2400, pay: "card" }];
  const demoDebts = [{ id: 1, who: "Айдос", note: "с 12 июля · без срока", sum: 40000, mine: true }];
  const storage = flaky({
    "qalta-proto-v1": JSON.stringify({ ops: demoOps, debts: demoDebts, lang: "en", hex: "#34C759", skin: 1, set: 1 }),
    "qalta-seed-hash": JSON.stringify([demoOps, demoDebts, []])
  });
  storage.failing = true;                                // the write of the migrated copy fails at first
  const c = app(storage).c;
  assert.equal(c.state.ops.length, 0);
  assert.equal(c.state.lang, "en", "the language the person chose survives");
  assert.equal(c.state.hex, "#34C759", "so does the accent");
  assert.notEqual(storage.getItem("qalta-seed-hash"), null, "kept until the migrated copy is stored");
  storage.failing = false;
  c.flush();
  assert.equal(storage.getItem("qalta-seed-hash"), null);
  const stored = JSON.parse(storage.getItem("qalta-proto-v1"));
  assert.equal(stored.ops.length, 0);
  assert.equal(stored.lang, "en");
});

test("what a blank device holds matches the app's initial state, and every data key is covered", () => {
  const h = app(), C = h.Component;
  const blank = Object.assign(C.blankData(), C.LOOK_DEFAULTS);
  const fresh = new C({});
  Object.keys(blank).forEach(k => assert.deepEqual(blank[k], fresh.state[k], k));
  assert.deepEqual(Object.keys(blank).concat(["gen"]).sort(), C.DATA_KEYS.slice().sort());
});

// ───────────────────────────── undo ─────────────────────────────

test("undo takes back only what the action changed: a debt that arrived meanwhile survives", () => {
  const h = app(), c = h.c;
  c.setState({ debts: [debt(1)] });
  c.openEntry({ mode: "repay", debt: c.state.debts[0] });
  type(c, "3 0 0 0");
  h.vals().en.save();
  assert.equal(c.state.debts[0].paid, 3000);
  c.setState({ debts: [debt(2, { who: "Мадина", mine: false, sum: 500 })].concat(c.state.debts) });   // another device
  c.runUndo();
  assert.deepEqual(c.state.debts.map(d => d.id + ":" + d.paid), ["2:0", "1:0"]);
});

test("undoing a category rename keeps operations that arrived meanwhile", () => {
  const h = app(), c = h.c, now = Date.now();
  c.setState({ ops: [op(1, { ts: now })] });
  c.openCatEdit({ kind: "expense", name: "Кафе" });
  c.setState({ ce: Object.assign({}, c.state.ce, { name: "Рестораны" }) });
  c.saveCategory();
  assert.equal(c.state.ops[0].cat, "Рестораны");
  c.setState({ ops: [op(2, { cat: "Дом", ts: now })].concat(c.state.ops) });      // arrives while the toast is up
  c.runUndo();
  assert.equal(c.state.ops.find(o => o.id === 1).cat, "Кафе");
  assert.equal(c.state.ops.find(o => o.id === 2).cat, "Дом", "untouched");
  assert.ok(c.cats("expense").indexOf("Кафе") >= 0 && c.cats("expense").indexOf("Рестораны") < 0);
});

test("undoing a category made from the picker unselects it in the open form", () => {
  const h = app(), c = h.c;
  c.openEntry({ mode: "op" });
  c.openCatEdit({ kind: "expense", name: null, then: "select" });
  c.setState({ ce: Object.assign({}, c.state.ce, { name: "Спортзал" }) });
  c.saveCategory();
  assert.equal(c.state.form.cat, "Спортзал");
  c.runUndo();
  assert.equal(c.state.form.cat, null);
  assert.ok(c.cats("expense").indexOf("Спортзал") < 0);
  assert.equal(h.vals().en.saveOff, true, "an operation cannot be saved into a category that no longer exists");
});

test("deleting a category and undoing puts it back where it was, with its operations", () => {
  const h = app(), c = h.c;
  c.setState({ ops: [op(1, { cat: "Аптека" })] });
  const idx = c.cats("expense").indexOf("Аптека");
  c.openCatEdit({ kind: "expense", name: "Аптека" });
  c.removeCategory();
  assert.ok(c.cats("expense").indexOf("Аптека") < 0);
  assert.notEqual(c.state.ops[0].cat, "Аптека");
  c.setState({ ops: [op(2, { cat: "Дом" })].concat(c.state.ops) });
  c.runUndo();
  assert.equal(c.cats("expense").indexOf("Аптека"), idx);
  assert.equal(c.state.ops.find(o => o.id === 1).cat, "Аптека");
  assert.equal(c.state.ops.find(o => o.id === 2).cat, "Дом");
});

test("the undo toast waits while the pointer or focus is on it, and Ctrl+Z triggers it", () => {
  const c = app().c;
  let undone = 0;
  c.showToast("x", () => { undone++; });
  c.toastPause(); c.toastResume();
  assert.ok(c.state.toast, "still there");
  let prevented = false;
  c.onKey({ key: "z", ctrlKey: true, target: { tagName: "DIV" }, preventDefault() { prevented = true; } });
  assert.equal(undone, 1);
  assert.equal(prevented, true);
  assert.equal(c.state.toast, null);
  c.showToast("y", () => { undone++; });
  c.onKey({ key: "z", ctrlKey: true, target: { tagName: "INPUT" }, preventDefault() {} });
  assert.equal(undone, 1, "inside a text field Ctrl+Z stays the browser's own");
});

// ───────────────────────────── import ─────────────────────────────

test("import says what it restored and what it skipped, and keeps this device's identity", async () => {
  const c = app().c;
  const gen = c.state.gen;
  c.setState({ ops: [op(1)] });
  await importFile(c, JSON.stringify({ gen: "someone-elses-copy", ops: [op(7), { id: 8, sum: "bad" }], debts: [debt(9)], closed: [] }));
  assert.deepEqual(c.state.ops.map(o => o.id), [7]);
  assert.equal(c.state.gen, gen);
  assert.match(c.state.toast.text, /операций 1, долгов 1; пропущено строк: 1/);
});

test("a file in which every row is rejected is refused and nothing is replaced", async () => {
  const c = app().c;
  c.setState({ ops: [op(1)] });
  await importFile(c, JSON.stringify({ ops: [{ id: 1, sum: "x" }, { id: 2, sum: 1e308 }], debts: [] }));
  assert.equal(c.state.ops.length, 1);
  assert.equal(c.state.bkCls, "tx-neg");
  assert.equal(c.state.toast, null);
});

test("import is refused when the copy of the current data cannot be saved", async () => {
  const storage = flaky();
  const c = app(storage).c;
  c.setState({ ops: [op(1)] });
  storage.failing = true; storage.failKeys = ["qalta-backup-before-import"];
  await importFile(c, JSON.stringify({ ops: [op(7)], debts: [] }));
  assert.equal(c.state.ops[0].id, 1);
  assert.equal(c.state.bkMsg, c.t().backupNoCopy);
});

test("undoing an import keeps records that arrived meanwhile", async () => {
  const c = app().c;
  c.setState({ ops: [op(1)] });
  await importFile(c, JSON.stringify({ ops: [op(7)], debts: [] }));
  c.setState({ ops: [op(9)].concat(c.state.ops) });       // synced in from another device
  c.runUndo();
  assert.deepEqual(c.state.ops.map(o => o.id).sort(), [1, 9]);
});

// ───────────────────────────── accounts ─────────────────────────────

test("switching accounts: a failed backup cancels the switch and wipes nothing; a good one starts clean", () => {
  const storage = flaky({ "qalta-last-uid": "A" });
  const c = app(storage).c;
  c.setState({ ops: [op(1)], budget: 5, catSizes: { "Тайная": "large" }, hex: "#34C759" });
  storage.failing = true; storage.failKeys = ["qalta-backup-before-switch"];
  assert.equal(c.prepareForAccount("B"), false);
  assert.equal(c.state.ops.length, 1);
  assert.equal(storage.getItem("qalta-last-uid"), "A", "the marker is put back");
  storage.failing = false;
  assert.equal(c.prepareForAccount("B"), true);
  assert.equal(c.state.ops.length, 0);
  assert.equal(c.state.budget, undefined);
  assert.deepEqual(c.state.catSizes, {}, "nothing private carries over to the new account");
  assert.equal(c.state.hex, "#34C759", "the device's look stays");
  assert.equal(JSON.parse(storage.getItem("qalta-backup-before-switch")).ops.length, 1);
  assert.equal(storage.getItem("qalta-last-uid"), "B");
});

test("a marker that cannot be written also cancels the switch (it would wipe again at every start)", () => {
  const storage = flaky({ "qalta-last-uid": "A" });
  const c = app(storage).c;
  c.setState({ ops: [op(1)] });
  storage.failing = true; storage.failKeys = ["qalta-last-uid"];
  assert.equal(c.prepareForAccount("B"), false);
  assert.equal(c.state.ops.length, 1);
});

test("a device with nothing of its own does not replace an older backup with an empty one", () => {
  const storage = flaky({ "qalta-last-uid": "A", "qalta-backup-before-switch": "OLD" });
  const c = app(storage).c;
  assert.equal(c.isSeed(), true);
  assert.equal(c.prepareForAccount("B"), true);
  assert.equal(storage.getItem("qalta-backup-before-switch"), "OLD");
  assert.equal(c.prepareForAccount("B"), true, "the same account again changes nothing");
});

// ───────────────────────────── edits ─────────────────────────────

test("saving an edit of an operation that vanished writes it again instead of losing what was typed", () => {
  const h = app(), c = h.c, now = Date.now();
  const op0 = op(5, { ts: now, date: "01.10" });
  c.setState({ ops: [op0] });
  c.openEntry({ mode: "op", edit: op0 });
  c.setState({ ops: [] });                                // deleted on another device meanwhile
  c.pressKey("clear"); type(c, "2 5 0");
  h.vals().en.save();
  assert.equal(c.state.ops.length, 1);
  assert.equal(c.state.ops[0].sum, -250);
  assert.equal(c.state.ops[0].id, 5);
  c.runUndo();
  assert.equal(c.state.ops.length, 0);
});

test("a debt's sum cannot go below what was repaid; equal to it settles the debt", () => {
  const h = app(), c = h.c;
  c.setState({ debts: [debt(1, { sum: 40000, paid: 15000, log: [{ sum: 15000, date: "01.10", id: "a" }] })] });
  c.openEntry({ mode: "debt", edit: c.state.debts[0] });
  c.pressKey("clear"); type(c, "1 0 0 0 0");
  let en = h.vals().en;
  assert.equal(en.saveOff, true);
  assert.match(en.hint, /15/, "the hint names the amount");
  en.save();
  assert.equal(h.vals().en.hintCls, "err");
  assert.equal(c.state.debts[0].sum, 40000, "nothing was saved");
  c.pressKey("clear"); type(c, "1 5 0 0 0");
  h.vals().en.save();
  assert.equal(c.state.debts.length, 0);
  assert.equal(c.state.closed.length, 1);
  assert.equal(c.state.closed[0].reason, "full");
  assert.equal(c.state.closed[0].sum, 15000);
});

test("a closed debt is history: no edit and no taking repayments back until it is restored", () => {
  const h = app(), c = h.c;
  c.setState({ closed: [debt(3, { paid: 10000, log: [{ sum: 10000, date: "01.10" }], closedAt: "01.10", reason: "full" })], debts: [debt(4)] });
  c.openLayer("debtView", { viewDebtId: 3 });
  let dv = h.vals().dv;
  assert.equal(dv.canEdit, false);
  assert.equal(dv.canTakeBack, false);
  c.closeKinds(["debtView"]);
  c.openLayer("debtView", { viewDebtId: 4 });
  dv = h.vals().dv;
  assert.equal(dv.canEdit, true);
  assert.equal(dv.canTakeBack, true);
});

test("a debt sheet closes by itself when its debt disappears", () => {
  const c = app().c;
  c.setState({ debts: [debt(1)] });
  c.openLayer("debtView", { viewDebtId: 1 }); c.componentDidUpdate();
  assert.equal(c.state.layers.length, 1);
  c.setState({ debts: [] }); c.componentDidUpdate();          // deleted on another device
  assert.equal(c.state.layers.length, 0);
  assert.equal(c.state.viewDebtId, null);
});

test("opening the due-date sheet commits the date it shows", () => {
  const h = app(), c = h.c;
  c.openEntry({ mode: "debt", side: "owed" });
  assert.equal(c.state.form.due, "");
  h.vals().en.openDue();
  const week = h.QL.ymd(h.QL.addDays(Date.now(), 7));
  assert.equal(c.state.form.due, week);
  assert.equal(h.vals().wh.date, week);
  assert.equal(h.vals().wh.hasClear, true, "and it can still be cleared");
});

// ───────────────────────────── focus and drag ─────────────────────────────

test("a press on a control in the sheet header is left alone; dragging the header captures the pointer", () => {
  const c = app().c;
  const sheet = { classList: { add() {}, remove() {} }, style: {} };
  let captured = 0;
  const header = { closest: sel => (sel === ".q-sheet" ? sheet : null), setPointerCapture() { captured++; } };
  c.sheetDown({ pointerType: "mouse", button: 0, target: { closest: () => ({}) }, currentTarget: header, clientY: 100, pointerId: 1 });
  assert.equal(c._drag == null, true, "a click on the close button or the Expense/Income switch starts no drag");
  c.sheetDown({ pointerType: "mouse", button: 0, target: { closest: () => null }, currentTarget: header, clientY: 100, pointerId: 1 });
  assert.ok(c._drag);
  c.sheetMove({ clientY: 102 });
  assert.equal(captured, 0, "a tiny movement is still a tap");
  c.sheetMove({ clientY: 140 });
  assert.equal(captured, 1);
});

test("closing the last sheet makes the page live before focus returns to the control that opened it", async () => {
  const h = app(), c = h.c;
  const seen = [];
  const main = { inert: false };
  const opener = { focus() { seen.push(main.inert); } };
  h.document.getElementById = id => (id === "q-main" ? main : id === "layer-entry" ? { focus() {} } : null);
  h.document.activeElement = opener;
  c.openEntry({ mode: "op" }); c.componentDidUpdate();
  assert.equal(main.inert, true);
  c.dismissTop(); c.componentDidUpdate();
  await wait(30);
  assert.equal(main.inert, false);
  assert.deepEqual(seen, [false], "focus was restored after the page became interactive");
});

test("a new release is announced and the shell offers to reload", () => {
  const h = app();
  assert.equal(h.vals().hasUpdate, false);
  h.c.setState({ updateReady: true });
  const v = h.vals();
  assert.equal(v.hasUpdate, true);
  assert.equal(v.updateText, "Доступна новая версия");
});

// ───────────────────────────── sync glue ─────────────────────────────

test("the data identity is part of what the sync engine sees, but never of what it uploads", () => {
  const Sync = require("../sync-engine.js");
  const c = app().c;
  assert.ok(typeof c.state.gen === "string");
  assert.equal("gen" in Sync.toEntities(c.state)["meta/settings"], false);
  assert.equal(Sync.SETTINGS_KEYS.indexOf("gen"), -1);
});

// ───────────────────────────── contrast of coloured surfaces ─────────────────────────────

test("every coloured surface that carries text reads at 4.5:1 in both appearances", () => {
  const h = app(), c = h.c, QL = h.QL;
  const check = (what, v) => {
    assert.ok(QL.contrast(v.fl, v.cl) >= 4.5, what + " (light) " + v.fl + " on " + v.cl + " = " + QL.contrast(v.fl, v.cl).toFixed(2));
    assert.ok(QL.contrast(v.fd, v.cd) >= 4.5, what + " (dark) " + v.fd + " on " + v.cd + " = " + QL.contrast(v.fd, v.cd).toFixed(2));
  };
  QL.PALETTE.forEach(p => check("palette " + p.id, c.palVis(p.id)));
  QL.DEFAULT_CATS.expense.concat(QL.DEFAULT_CATS.income).forEach(n => check("category " + n, c.vis(n)));
  ["Айдос", "Мадина", "Zhanna", "Ә", "constructor"].forEach(n => check("avatar " + n, c.palFor(n)));
  c.setState({ catColors: { "Кафе": "#FF3B30", "Дом": "#0A84FF", "Спорт": "#FFFF00" } });
  ["Кафе", "Дом", "Спорт"].forEach(n => check("custom " + n, c.vis(n)));
});
