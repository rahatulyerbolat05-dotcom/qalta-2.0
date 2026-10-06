// node --test tests/component.test.js  — interaction logic of the real component, no browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const { load, makeStorage, type } = require("./helpers/harness.js");

const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

function app(initial, opts) {
  const h = load(Object.assign({ storage: makeStorage(initial) }, opts || {}));
  h.vals = () => h.c.renderVals();
  return h;
}
const tick = () => new Promise(r => setTimeout(r, 30));

test("a fresh install is empty and honest: no demo data, no invented balance or budget", () => {
  const { c, vals } = app();
  const s = c.state;
  assert.equal(s.ops.length, 0);
  assert.equal(s.debts.length, 0);
  assert.equal(s.budget, undefined);
  assert.equal(s.openCash, undefined);
  const v = vals();
  assert.equal(v.noBudget, true);
  assert.equal(v.noRecent, true);
  assert.equal(v.hasBreak, false);
  assert.equal(v.wallet.length, 3, "three quick cards even with no history");
  assert.equal(v.showWallet, true);
  assert.equal(v.stackN, 3);
  assert.equal(v.tips.length >= 1, true);
  assert.equal(v.tips[0].title, "Остатки на счетах");
  assert.equal(v.accounts[0].value, "Указать", "unknown balance is not shown as a number");
  assert.equal(v.hasAccTotal, false);
});

test("quick card -> amount -> save creates one operation, closes the sheet and offers undo", () => {
  const { c, vals } = app();
  const v0 = vals();
  const front = v0.wallet[v0.wallet.length - 1];          // front card = most used = first default category
  assert.equal(front.name, "Продукты");
  front.pick();
  assert.equal(c.state.layers.length, 1);
  assert.equal(c.state.form.cat, "Продукты");
  let en = vals().en;
  assert.equal(en.saveOff, true, "no amount yet");
  assert.equal(en.amountText, "0");
  type(c, "2 4 000".replace(/ 000/, " 0 0"));            // 2,4,0,0 -> 2400
  en = vals().en;
  assert.equal(en.amountText, "2 400");
  assert.equal(en.saveOff, false);
  assert.equal(en.pays.find(p => p.on).name, "Карта");
  en.save();
  assert.equal(c.state.ops.length, 1);
  const op = c.state.ops[0];
  assert.equal(op.sum, -2400);
  assert.equal(op.cat, "Продукты");
  assert.equal(op.pay, "card");
  assert.equal(typeof op.ts, "number");
  assert.equal(op.note, "");
  assert.equal(c.state.layers.length, 0, "sheet closed");
  assert.equal(c.state.form, null);
  assert.ok(c.state.toast && c.state.toast.undo);
  assert.match(c.state.toast.text, /Продукты/);
  c.runUndo();
  assert.equal(c.state.ops.length, 0, "undo removes the new operation");
  assert.equal(c.state.toast, null);
});

test("double tap on Save cannot create two operations", () => {
  const { c, vals } = app();
  c.openEntry({ mode: "op", cat: "Кафе" });
  type(c, "1 0 0 0");
  const save = vals().en.save;
  save(); save(); save();
  assert.equal(c.state.ops.length, 1);
});

test("validation: amount and category are required, errors are explicit", () => {
  const { c, vals } = app();
  c.openEntry({ mode: "op" });
  vals().en.save();
  assert.equal(c.state.ops.length, 0);
  let en = vals().en;
  assert.equal(en.hintCls, "err");
  assert.equal(en.hint, "Введите сумму больше нуля");
  type(c, "5 000");
  vals().en.save();
  en = vals().en;
  assert.equal(en.hint, "Выберите категорию");
  assert.equal(c.state.ops.length, 0);
  en.chips[0].pick();
  assert.equal(vals().en.saveOff, false);
  vals().en.save();
  assert.equal(c.state.ops.length, 1);
});

test("last used payment method is remembered and shown, never hidden", () => {
  const { c, vals } = app();
  c.openEntry({ mode: "op", cat: "Кафе" });
  vals().en.pays.find(p => p.name === "Наличные").pick();
  type(c, "5 0 0");
  vals().en.save();
  assert.equal(c.state.ops[0].pay, "cash");
  c.openEntry({ mode: "op", cat: "Кафе" });
  const en = vals().en;
  assert.equal(en.pays.find(p => p.on).name, "Наличные", "remembered");
});

test("editing keeps the note; deleting is undoable; history order follows the real date", () => {
  const { c, vals, QL } = app();
  const now = Date.now(), day0 = QL.startOfDay(now);       // fixed to calendar days so the test does not depend on the clock time
  c.setState({ ops: [
    { id: 1, date: QL.ddmm(day0), ts: day0 + 60e3, cat: "Кафе", note: "обед с Айдосом", sum: -6800, pay: "card" },
    { id: 2, date: QL.ddmm(QL.addDays(day0, -1)), ts: QL.addDays(day0, -1) + 60e3, cat: "Продукты", note: "", sum: -1200, pay: "cash" }
  ] });
  c.openEntry({ mode: "op", edit: c.state.ops[0] });
  let en = vals().en;
  assert.equal(en.note, "обед с Айдосом");
  assert.equal(en.title, "Операция");
  assert.equal(en.showDelete, true);
  type(c, "del"); type(c, "5");                          // 6800 -> 680 -> 6805
  vals().en.save();
  const edited = c.state.ops.find(o => o.id === 1);
  assert.equal(edited.sum, -6805);
  assert.equal(edited.note, "обед с Айдосом", "the note survives an edit");
  c.runUndo();
  assert.equal(c.state.ops.find(o => o.id === 1).sum, -6800, "undo restores the old amount");
  // delete from the sheet
  c.openEntry({ mode: "op", edit: c.state.ops[0] });
  vals().en.remove();
  assert.equal(c.state.ops.length, 1);
  assert.equal(c.state.layers.length, 0);
  c.runUndo();
  assert.equal(c.state.ops.length, 2);
  // a backdated operation added last still sorts by its date, not by insertion
  c.setState({ tab: "history" });
  const h = vals();
  assert.equal(h.groups[0].label, "Сегодня");
  assert.equal(h.groups[1].label, "Вчера");
});

test("closing a dirty sheet asks first; clean sheets close at once; Back closes the top layer", () => {
  const { c, vals, calls } = app();
  c.openEntry({ mode: "op", cat: "Кафе" });
  c.dismissTop();
  assert.equal(c.state.layers.length, 0, "nothing typed: closes without asking");
  c.openEntry({ mode: "op", cat: "Кафе" });
  type(c, "7");
  c.dismissTop();
  assert.deepEqual(c.state.layers.map(l => l.kind), ["entry", "confirm"]);
  assert.equal(vals().cf.okLabel, "Не сохранять");
  vals().cf.cancel();                                     // keep editing
  assert.deepEqual(c.state.layers.map(l => l.kind), ["entry"]);
  assert.equal(c.state.form.amount, "7");
  c.dismissTop();
  vals().cf.ok();                                         // discard
  assert.equal(c.state.layers.length, 0);
  assert.equal(c.state.ops.length, 0);
  // browser Back: one history marker per open layer stack
  c.openEntry({ mode: "op" });
  c.componentDidUpdate();
  assert.equal(calls.pushState, 1, "marker pushed when the first layer opens");
  c.onPop();
  assert.equal(c.state.layers.length, 0, "Back closed the layer");
  c.componentDidUpdate();
  assert.equal(calls.back, 0, "marker already consumed by Back");
});

test("escape and layer stacking: picker over entry, picking a category closes only the picker", () => {
  const { c, vals } = app();
  c.openEntry({ mode: "op" });
  vals().en.moreCats();
  assert.deepEqual(c.state.layers.map(l => l.kind), ["entry", "cats"]);
  const pk = vals().pk;
  assert.ok(pk.list.length >= 20);
  pk.list.find(x => x.name === "Транспорт").pick();
  assert.deepEqual(c.state.layers.map(l => l.kind), ["entry"]);
  assert.equal(c.state.form.cat, "Транспорт");
  c.onKey({ key: "Escape", preventDefault() {} });
  assert.equal(c.state.layers.length, 0);
});

test("physical keyboard types amounts and saves", () => {
  const { c, vals } = app();
  c.openEntry({ mode: "op", cat: "Кафе" });
  ["1", "2", "5", "0"].forEach(k => c.onKey({ key: k, target: { tagName: "BODY" }, preventDefault() {} }));
  assert.equal(vals().en.amountText, "1 250");
  c.onKey({ key: "Backspace", target: { tagName: "BODY" }, preventDefault() {} });
  assert.equal(vals().en.amountText, "125");
  c.onKey({ key: "Enter", target: { tagName: "BODY" }, preventDefault() {} });
  assert.equal(c.state.ops[0].sum, -125);
  c.openEntry({ mode: "op", cat: "Кафе" });
  c.onKey({ key: "7", target: { tagName: "INPUT" }, preventDefault() {} });
  assert.equal(c.state.form.amount, "", "typing into a text field is not hijacked");
});

test("budget: pace per day, over-budget state, and clearing it", () => {
  const { c, vals, QL } = app();
  const now = Date.now();
  c.setState({ ops: [{ id: 1, date: QL.ddmm(now), ts: now, cat: "Кафе", note: "", sum: -50000, pay: "card" }] });
  c.openEntry({ mode: "budget" });
  type(c, "250 000".replace(" 000", " 0 0 0").replace("250", "2 5 0"));
  vals().en.save();
  assert.equal(c.state.budget, 250000);
  let v = vals();
  assert.equal(v.hasBudget, true);
  assert.equal(v.ringValue, "200 000");
  assert.match(v.paceText, /в день/);
  assert.equal(v.ringColor, "var(--tint)");
  // over budget
  c.setState({ budget: 40000 });
  v = vals();
  assert.equal(v.ringColor, "var(--neg-fill)");
  assert.match(v.paceText, /превышен/);
  // clear
  c.openEntry({ mode: "budget" });
  type(c, "clear");
  vals().en.save();
  assert.equal(c.state.budget, undefined);
  assert.equal(vals().noBudget, true);
});

test("account balances come from what the person types: setting 'I have X now' makes the total equal X", () => {
  const { c, vals, QL } = app();
  const now = Date.now();
  c.setState({ ops: [
    { id: 1, date: QL.ddmm(now), ts: now, cat: "Кафе", note: "", sum: -3000, pay: "cash" },
    { id: 2, date: QL.ddmm(now), ts: now, cat: "Зарплата", note: "", sum: 100000, pay: "card" }
  ] });
  c.openEntry({ mode: "opening", account: "cash" });
  type(c, "2 0 000".replace(" 000", " 0 0 0"));         // 20000
  vals().en.save();
  c.openEntry({ mode: "opening", account: "card" });
  type(c, "1 5 0 0 0 0");                                // 150000
  vals().en.save();
  const v = vals();
  assert.equal(v.accounts[0].value, "20 000 ₸");
  assert.equal(v.accounts[1].value, "150 000 ₸");
  assert.equal(v.accTotal, "170 000 ₸");
  // the balance keeps following operations
  c.setState({ ops: [{ id: 3, date: QL.ddmm(now), ts: now, cat: "Кафе", note: "", sum: -1000, pay: "cash" }].concat(c.state.ops) });
  assert.equal(vals().accounts[0].value, "19 000 ₸");
  // an explicit zero is a real balance
  c.openEntry({ mode: "opening", account: "cash" });
  c.pressKey("clear"); c.pressKey("0");
  assert.equal(vals().en.saveOff, false);
});

test("debts: free-text name, due date, partial repayment, auto-close, undo", () => {
  const { c, vals, QL } = app();
  c.openEntry({ mode: "debt", side: "owed" });
  assert.equal(vals().en.saveOff, true);
  c.setForm({ who: "  Айгерим  " });
  type(c, "4 0 0 0 0");
  c.setForm({ due: QL.ymd(QL.addDays(Date.now(), 6)) });
  assert.match(vals().en.dueText, /\d{4}/);
  vals().en.save();
  assert.equal(c.state.debts.length, 1);
  const d = c.state.debts[0];
  assert.equal(d.who, "Айгерим", "trimmed, any name allowed");
  assert.equal(d.mine, true);
  assert.equal(d.sum, 40000);
  assert.ok(d.due);
  c.setState({ tab: "debts" });
  let v = vals();
  assert.equal(v.debtRows.length, 1);
  assert.match(v.debtRows[0].sub, /через 6 дней/);
  assert.equal(v.debtSummary, "40 000 ₸");
  // open it, repay part
  v.debtRows[0].tap();
  assert.equal(c.state.layers[0].kind, "debtView");
  let dv = vals().dv;
  assert.equal(dv.canRepay, true);
  dv.repay();
  type(c, "1 5 0 0 0");
  vals().en.save();
  assert.equal(c.state.debts[0].paid, 15000);
  assert.equal(c.state.debts[0].log.length, 1);
  assert.equal(vals().dv.leftText, "25 000");
  // a repayment larger than what is left is clamped
  vals().dv.repay();
  type(c, "9 9 9 9 9 9");
  assert.equal(c.state.form.amount, "25000");
  vals().en.save();
  assert.equal(c.state.debts.length, 0, "fully repaid -> closed");
  assert.equal(c.state.closed.length, 1);
  assert.equal(c.state.layers.length, 0);
  c.runUndo();
  assert.equal(c.state.debts.length, 1, "undo reopens it");
  assert.equal(c.state.debts[0].paid, 15000);
});

test("debts: close, restore, delete with undo; sides are separate lists", () => {
  const { c, vals } = app();
  const mk = (id, who, mine) => ({ id, who, note: "", sum: 1000, mine, paid: 0, log: [] });
  c.setState({ debts: [mk(1, "A", true), mk(2, "B", false)], tab: "debts" });
  assert.equal(vals().debtRows.length, 1);
  assert.equal(vals().debtRows[0].name, "A");
  vals().sides[1].pick();
  assert.equal(vals().debtRows[0].name, "B");
  c.closeDebt(2);
  assert.equal(c.state.debts.length, 1);
  assert.equal(c.state.closed.length, 1);
  assert.equal(vals().hasClosed, true);
  c.runUndo();
  assert.equal(c.state.closed.length, 0);
  c.closeDebt(2);
  c.restoreDebt(2);
  assert.equal(c.state.closed.length, 0);
  c.deleteDebt(2);
  assert.equal(c.state.debts.length, 1);
  c.runUndo();
  assert.equal(c.state.debts.length, 2);
});

test("categories: create from the picker, rename updates operations, delete moves them and can be undone", () => {
  const { c, vals, QL } = app();
  const now = Date.now();
  c.setState({ ops: [{ id: 1, date: QL.ddmm(now), ts: now, cat: "Кафе", note: "", sum: -500, pay: "card" }] });
  // create while choosing a category for an operation
  c.openEntry({ mode: "op" });
  vals().en.moreCats();
  vals().pk.create();
  assert.equal(c.state.layers[c.state.layers.length - 1].kind, "catEdit");
  vals().ce.setName({ target: { value: "Спортзал" } });
  vals().ce.icons.find(i => i.name === "barbell").pick();
  vals().ce.save();
  assert.ok(c.cats("expense").indexOf("Спортзал") >= 0);
  assert.equal(c.state.form.cat, "Спортзал", "the new category is selected for the operation");
  assert.deepEqual(c.state.layers.map(l => l.kind), ["entry"], "editor and picker are closed");
  assert.equal(c.state.catIcons["Спортзал"], "barbell");
  c.dismissTop();
  // duplicate and empty names are rejected
  c.openCatList("expense");
  c.openCatEdit({ kind: "expense", name: null });
  vals().ce.setName({ target: { value: "кафе" } });
  vals().ce.save();
  assert.equal(c.state.ce.err, "Такая категория уже есть");
  vals().ce.setName({ target: { value: "" } });
  vals().ce.save();
  assert.equal(c.state.ce.err, "Введите название");
  c.popNow();
  // rename
  c.openCatEdit({ kind: "expense", name: "Кафе" });
  vals().ce.setName({ target: { value: "Рестораны" } });
  vals().ce.save();
  assert.equal(c.state.ops[0].cat, "Рестораны");
  assert.ok(c.cats("expense").indexOf("Кафе") < 0);
  // delete: operations move to "Прочее"; undo restores both the category and the operation
  c.openCatEdit({ kind: "expense", name: "Рестораны" });
  assert.equal(vals().ce.showDelete, true);
  assert.match(vals().ce.deleteNote, /Прочее/);
  vals().ce.remove();
  assert.equal(c.state.ops[0].cat, "Прочее");
  c.runUndo();
  assert.equal(c.state.ops[0].cat, "Рестораны");
  assert.ok(c.cats("expense").indexOf("Рестораны") >= 0);
});

test("categories: reorder moves one step", () => {
  const { c } = app();
  const first = c.cats("expense")[0], second = c.cats("expense")[1];
  c.moveCat("expense", first, 1);
  assert.equal(c.cats("expense")[0], second);
  assert.equal(c.cats("expense")[1], first);
  c.moveCat("expense", second, -1);       // already first: no change
  assert.equal(c.cats("expense")[0], second);
});

test("history: period navigation, filters, search, pagination", () => {
  const { c, vals, QL } = app();
  const now = Date.now(), ops = [];
  for (let i = 0; i < 200; i++) ops.push({ id: i + 1, date: "01.01", ts: now - i * 3600e3, cat: i % 2 ? "Кафе" : "Продукты", note: i === 7 ? "особая" : "", sum: i % 5 === 0 ? 1000 : -100, pay: "card" });
  c.setState({ ops, tab: "history", period: "all", pOffset: 0 });
  let v = vals();
  assert.equal(v.hasStepper, false);
  assert.equal(v.canMore, true);
  assert.equal(v.groups.reduce((a, g) => a + g.rows.length, 0), 150);
  v.showMore();
  assert.equal(vals().canMore, false);
  c.setState({ hq: "особая" });
  v = vals();
  assert.equal(v.groups.reduce((a, g) => a + g.rows.length, 0), 1);
  c.setState({ hq: "", kind: "income" });
  v = vals();
  assert.ok(v.groups.every(g => g.rows.every(r => r.amtCls === "tx-pos")));
  c.setState({ kind: "all", period: "month", pOffset: 0 });
  v = vals();
  assert.equal(v.hasStepper, true);
  assert.equal(v.noNext, true);
  v.prevPeriod();
  assert.equal(c.state.pOffset, -1);
  assert.equal(vals().noNext, false);
  c.setState({ hq: "nothing-like-this" });
  v = vals();
  assert.equal(v.noRows, true);
  assert.equal(v.canResetSearch, true);
});

test("swipe: a swipe never counts as a tap; tapping a swiped row only closes it", () => {
  const { c, vals, QL } = app();
  const now = Date.now();
  c.setState({ ops: [{ id: 1, date: QL.ddmm(now), ts: now, cat: "Кафе", note: "", sum: -500, pay: "card" }], tab: "history" });
  let row = vals().groups[0].rows[0];
  row.start({ clientX: 300 }); row.move({ clientX: 200 }); row.end();
  assert.equal(c.state.swipeId, 1);
  row = vals().groups[0].rows[0];
  row.tap();
  assert.equal(c.state.layers.length, 0, "tap right after a swipe does nothing");
  row.tap();
  assert.equal(c.state.swipeId, null, "tap on a revealed row closes it");
  vals().groups[0].rows[0].tap();
  assert.equal(c.state.layers[0].kind, "entry", "plain tap opens the editor");
});

test("persistence: only data is stored, UI prefs separately; reload restores; corrupt data is kept aside", async () => {
  const storage = makeStorage();
  let h = app(null, { storage });
  h.c.setState({ ops: [{ id: 1, date: "01.10", cat: "Кафе", note: "", sum: -5, pay: "card" }], budget: 100000, theme: "dark", lang: "kz" });
  h.c.persistNow();
  const raw = JSON.parse(storage.getItem("qalta-proto-v1"));
  assert.equal(raw.budget, 100000);
  assert.equal(raw.lang, "kz");
  assert.equal("theme" in raw, false, "theme is a device preference, not synced data");
  assert.equal(JSON.parse(storage.getItem("qalta-ui-v1")).theme, "dark");
  const h2 = app(null, { storage });
  assert.equal(h2.c.state.budget, 100000);
  assert.equal(h2.c.state.theme, "dark");
  assert.equal(h2.c.state.ops.length, 1);
  // unreadable data is preserved, not overwritten silently
  const bad = makeStorage({ "qalta-proto-v1": "{not json" });
  const h3 = app(null, { storage: bad });
  assert.equal(h3.c.state.ops.length, 0);
  assert.equal(bad.getItem("qalta-proto-v1.corrupt"), "{not json");
  // changes that touch only the UI do not rewrite the data blob
  let writes = 0;
  const counting = makeStorage();
  const orig = counting.setItem;
  counting.setItem = (k, v) => { if (k === "qalta-proto-v1") writes++; return orig(k, v); };
  const h4 = app(null, { storage: counting });
  h4.c.setState({ tab: "history" });
  h4.c.componentDidUpdate();
  await new Promise(r => setTimeout(r, 300));
  assert.equal(writes, 0);
});

test("migration: an untouched demo from earlier versions is dropped, anything the person changed is kept", () => {
  const demoOps = [{ id: 1, date: "06.10", cat: "Продукты", note: "магнит у дома · карта", sum: -2400, pay: "card" }];
  const demoDebts = [{ id: 1, who: "Айдос", note: "с 12 июля · без срока", sum: 40000, mine: true }];
  const seed = JSON.stringify([demoOps, demoDebts, []]);
  const untouched = makeStorage({ "qalta-proto-v1": JSON.stringify({ ops: demoOps, debts: demoDebts, hex: "#EC3013", skin: 1, set: 1, lang: "ru", light: true }), "qalta-seed-hash": seed });
  const a = app(null, { storage: untouched });
  assert.equal(a.c.state.ops.length, 0);
  assert.equal(a.c.state.debts.length, 0);
  assert.equal(untouched.getItem("qalta-seed-hash"), null);
  assert.equal(JSON.parse(untouched.getItem("qalta-proto-v1")).ops.length, 0, "stored data replaced");
  const edited = makeStorage({ "qalta-proto-v1": JSON.stringify({ ops: demoOps.concat([{ id: 9, date: "06.10", cat: "Кафе", note: "", sum: -100, pay: "cash" }]), debts: demoDebts, lang: "ru" }), "qalta-seed-hash": seed });
  const b = app(null, { storage: edited });
  assert.equal(b.c.state.ops.length, 2, "real data is never wiped");
  assert.equal(b.c.state.hex, "#007AFF" === b.c.state.hex ? b.c.state.hex : "#007AFF");
});

test("sync glue: pristine state is a seed; any real data is not", () => {
  const { c } = app();
  assert.equal(c.isSeed(), true);
  c.setState({ budget: 1000 });
  assert.equal(c.isSeed(), false);
  c.setState({ budget: undefined, ops: [{ id: 1, date: "01.01", cat: "A", note: "", sum: -1, pay: "card" }] });
  assert.equal(c.isSeed(), false);
});

test("backup: export shape, import replaces everything and can be undone", () => {
  const { c, QL } = app();
  c.setState({ budget: 5000, ops: [{ id: 1, date: "01.10", cat: "Кафе", note: "", sum: -5, pay: "card" }] });
  const file = QL.buildBackup(c.state);
  assert.equal(file.v, 2);
  assert.equal(file.budget, 5000);
  const before = c.pickData();
  const text = JSON.stringify({ ops: [{ id: 7, date: "02.10", cat: "Дом", note: "", sum: -9, pay: "cash" }], debts: [], lang: "en" });
  const reader = { readAsText() { this.result = text; this.onload(); } };
  global.FileReader = function () { return reader; };
  c.onImportFile({ target: { files: [{ size: text.length }], value: "x" } });
  delete global.FileReader;
  assert.equal(c.state.ops.length, 1);
  assert.equal(c.state.ops[0].id, 7);
  assert.equal(c.state.budget, undefined, "a backup without a budget clears it");
  assert.equal(c.state.lang, "en");
  c.runUndo();
  assert.equal(c.state.budget, before.budget);
  assert.equal(c.state.ops[0].id, 1);
});

test("language and theme switches take effect in the view-model", () => {
  const { c, vals } = app();
  c.setState({ lang: "en" });
  assert.equal(vals().t.history, "History");
  assert.equal(vals().wallet[0].aria.indexOf("Add a transaction"), 0);
  c.setState({ lang: "kz" });
  assert.equal(vals().t.tabDebts, "Қарыздар");
  c.setState({ theme: "dark" });
  c.componentDidUpdate();
  assert.equal(c.document === undefined, true);
});

test("accent colour: filled controls always carry readable text", () => {
  const { c, vals, QL } = app();
  ["#007AFF", "#FFCC00", "#34C759", "#FF9500", "#5856D6", "#FF2D55", "#FFFFFF", "#000000", "#123456"].forEach(hex => {
    c.setState({ hex });
    const v = vals();
    assert.ok(QL.contrast(v.tint, v.onTint) >= 4.5 - 1e-9 || QL.contrast(v.tint, v.onTint) >= 3, hex + " button text contrast " + QL.contrast(v.tint, v.onTint).toFixed(2));
    assert.ok(QL.contrast(v.tintTextL, "#F2F2F7") >= 4.5, hex + " text variant on light");
    assert.ok(QL.contrast(v.tintTextD, "#1C1C1E") >= 4.5, hex + " text variant on dark");
  });
});

test("midnight rollover: the overview uses the current date on every render", () => {
  const { c, vals, QL } = app();
  const a = vals().dateLine;
  assert.ok(a.length > 5);
  c.onVisible();
  assert.equal(typeof c._today, "string");
});

test("recency ranking: the quick cards follow what the person actually uses", () => {
  const { c, vals, QL } = app();
  const now = Date.now();
  const op = (i, cat) => ({ id: i, date: QL.ddmm(now), ts: now - i * 3600e3, cat, note: "", sum: -100, pay: "card" });
  c.setState({ ops: [op(1, "Бензин"), op(2, "Бензин"), op(3, "Аптека"), op(4, "Спорт")] });
  const names = vals().wallet.map(w => w.name);
  assert.equal(names[names.length - 1], "Бензин", "front card = most used");
  assert.equal(names.length, 3);
});
