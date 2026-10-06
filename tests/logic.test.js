// node --test tests/logic.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/logic.js");

const NOW = new Date(2026, 9, 6, 15, 30).getTime(); // Tue 6 Oct 2026, 15:30 local
const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test("keypadPress: digits, zeros, limits", () => {
  assert.equal(L.keypadPress("", "5"), "5");
  assert.equal(L.keypadPress("5", "000"), "5000");
  assert.equal(L.keypadPress("", "000"), "");
  assert.equal(L.keypadPress("", "0"), "");
  assert.equal(L.keypadPress("12", "del"), "1");
  assert.equal(L.keypadPress("", "del"), "");
  assert.equal(L.keypadPress("123", "clear"), "");
  assert.equal(L.keypadPress("123456789", "1"), "123456789", "9 digits max");
  assert.equal(L.keypadPress("12345678", "000"), "12345678", "would exceed 9 digits");
  assert.equal(L.keypadPress("5", "abc"), "5", "unknown key ignored");
  assert.equal(L.amountFromDigits("999999999"), 999999999);
  assert.equal(L.amountFromDigits(""), 0);
});

test("fmtInt/fmtSigned: no-break groups, en comma, sign", () => {
  assert.equal(L.fmtInt(1200, "ru"), "1 200");
  assert.equal(L.fmtInt(1200, "kz"), "1 200");
  assert.equal(L.fmtInt(1200, "en"), "1,200");
  assert.equal(L.fmtInt(-2400, "ru"), "2 400");
  assert.equal(L.fmtInt(0, "ru"), "0");
  assert.equal(L.fmtInt("junk", "ru"), "0");
  assert.equal(L.fmtInt(999999999, "ru"), "999 999 999");
  assert.equal(L.fmtSigned(-2400, "ru"), "−2 400");
  assert.equal(L.fmtSigned(2400, "ru", true), "+2 400");
  assert.equal(L.fmtSigned(2400, "ru"), "2 400");
  assert.ok(!/ /.test(L.fmtInt(1234567, "ru")), "no breaking space inside a number");
});

test("parseYmd / combineDateTime / dayDiff", () => {
  assert.equal(L.parseYmd("2026-02-30"), null);
  assert.equal(L.parseYmd("2026-13-01"), null);
  assert.equal(L.parseYmd("abc"), null);
  assert.ok(L.parseYmd("2024-02-29") != null, "leap day");
  assert.equal(L.parseYmd("2026-02-29"), null, "not a leap year");
  assert.equal(L.ymd(L.parseYmd("2026-10-06")), "2026-10-06");
  const t = L.combineDateTime("2026-10-06", "14:30", NOW);
  assert.equal(new Date(t).getHours(), 14);
  assert.equal(new Date(t).getMinutes(), 30);
  assert.equal(L.combineDateTime("nope", "14:30", NOW), NOW, "bad date -> fallback");
  assert.equal(new Date(L.combineDateTime("2026-10-06", "", NOW)).getHours(), 12, "no time -> noon");
  assert.equal(L.parseHhmm("24:00"), null);
  assert.equal(L.parseHhmm("09:05"), 545);
  // calendar days, independent of DST length of the day
  assert.equal(L.dayDiff(new Date(2026, 2, 29, 0, 30).getTime(), new Date(2026, 2, 28, 23, 30).getTime()), 1);
  assert.equal(L.dayDiff(NOW, NOW), 0);
  assert.equal(L.dayDiff(at(2026, 10, 1), at(2026, 10, 6)), -5);
});

test("legacy DD.MM -> timestamp with inferred year", () => {
  assert.equal(L.ymd(L.tsFromDdmm("06.10", NOW)), "2026-10-06");
  assert.equal(L.ymd(L.tsFromDdmm("30.09", NOW)), "2026-09-30");
  assert.equal(L.ymd(L.tsFromDdmm("08.10", NOW)), "2025-10-08", "future date means last year");
  assert.equal(L.tsFromDdmm("31.04", NOW), null);
  assert.equal(L.ymd(L.tsFromDdmm("29.02", NOW)), "2024-02-29", "2026 and 2025 are not leap years: the last 29 February was in 2024");
  assert.equal(L.tsFromDdmm("x", NOW), null);
  assert.equal(L.tsOfOp({ ts: 123, date: "01.01" }, NOW), 123, "own timestamp wins");
  assert.equal(L.ymd(L.tsOfOp({ date: "05.10" }, NOW)), "2026-10-05");
  assert.equal(L.tsOfOp({ date: "??" }, NOW), NOW);
});

test("periodRange and labels", () => {
  const m = L.periodRange("month", NOW, 0);
  assert.equal(L.ymd(m.from), "2026-10-01");
  assert.equal(L.ymd(m.to), "2026-11-01");
  const pm = L.periodRange("month", NOW, -1);
  assert.equal(L.ymd(pm.from), "2026-09-01");
  const wrap = L.periodRange("month", at(2026, 1, 15), -1);
  assert.equal(L.ymd(wrap.from), "2025-12-01");
  const w = L.periodRange("week", NOW, 0); // Tuesday -> Monday 5 Oct
  assert.equal(L.ymd(w.from), "2026-10-05");
  assert.equal(L.ymd(w.to), "2026-10-12");
  assert.equal(L.ymd(L.periodRange("week", NOW, -1).from), "2026-09-28");
  const y = L.periodRange("year", NOW, 0);
  assert.equal(L.ymd(y.from), "2026-01-01");
  assert.equal(L.periodRange("all", NOW).from, -Infinity);
  assert.ok(L.inRange(NOW, m) && !L.inRange(at(2026, 9, 30), m));
  assert.equal(L.periodLabel(m, "ru", NOW), "Октябрь");
  assert.match(L.periodLabel(pm, "en", NOW), /September/);
  assert.match(L.periodLabel(L.periodRange("month", NOW, -12), "ru", NOW), /2025/, "other year shows the year");
  assert.equal(L.periodLabel(y, "ru", NOW), "2026");
});

test("daysInMonth / daysLeftInMonth", () => {
  assert.equal(L.daysInMonth(NOW), 31);
  assert.equal(L.daysLeftInMonth(NOW), 26);
  assert.equal(L.daysLeftInMonth(at(2026, 10, 31)), 1);
  assert.equal(L.daysInMonth(at(2028, 2, 10)), 29);
  assert.equal(L.daysInMonth(at(2027, 2, 10)), 28);
});

test("dayLabel", () => {
  const words = { today: "Сегодня", yesterday: "Вчера" };
  assert.equal(L.dayLabel(NOW, NOW, "ru", words), "Сегодня");
  assert.equal(L.dayLabel(at(2026, 10, 5), NOW, "ru", words), "Вчера");
  assert.match(L.dayLabel(at(2026, 10, 2), NOW, "ru", words), /2 октября/);
  assert.match(L.dayLabel(at(2025, 12, 31), NOW, "ru", words), /2025/);
});

const op = (id, d, cat, sum, pay = "card", extra = {}) => Object.assign({ id, date: d, cat, note: "", sum, pay }, extra);

test("sortOps: by time, then id; legacy and new mixed", () => {
  const a = op(1, "06.10", "A", -1);
  const b = op(2, "05.10", "B", -1, "card", { ts: at(2026, 10, 6, 9, 0) }); // backdated entry made later but dated today 09:00
  const c = op(3, "06.10", "C", -1, "card", { ts: at(2026, 10, 6, 14, 0) });
  const sorted = L.sortOps([a, b, c], NOW).map(o => o.cat);
  assert.deepEqual(sorted, ["C", "A", "B"], "14:00, legacy noon, 09:00");
  // regression: an operation dated yesterday but added last must not float above today's
  const yesterday = op(99, "05.10", "Y", -1, "card", { ts: at(2026, 10, 5, 20, 0) });
  assert.equal(L.sortOps([yesterday, c], NOW)[0].cat, "C");
});

test("groupByDay: sums and labels", () => {
  const ops = [
    op(1, "06.10", "A", -100, "card", { ts: at(2026, 10, 6, 10) }),
    op(2, "06.10", "B", 500, "card", { ts: at(2026, 10, 6, 11) }),
    op(3, "05.10", "C", -50, "card", { ts: at(2026, 10, 5, 12) })
  ];
  const g = L.groupByDay(ops, NOW, "ru", { today: "Сегодня", yesterday: "Вчера" });
  assert.equal(g.length, 2);
  assert.equal(g[0].label, "Сегодня");
  assert.equal(g[0].sum, 400);
  assert.equal(g[0].ops[0].cat, "B", "newest first inside the day");
  assert.equal(g[1].label, "Вчера");
  assert.equal(g[1].count, 1);
});

test("filterOps, totals, byCategory", () => {
  const ops = [
    op(1, "06.10", "Продукты", -2400, "card", { ts: at(2026, 10, 6) , note: "магнит"}),
    op(2, "06.10", "Кафе", -6800, "cash", { ts: at(2026, 10, 6) }),
    op(3, "01.09", "Зарплата", 240000, "card", { ts: at(2026, 9, 1) }),
    op(4, "02.10", "Продукты", -1000, "card", { ts: at(2026, 10, 2) })
  ];
  const month = L.periodRange("month", NOW, 0);
  assert.equal(L.filterOps(ops, { range: month, kind: "all" }, NOW).length, 3);
  assert.equal(L.filterOps(ops, { range: month, kind: "income" }, NOW).length, 0);
  assert.equal(L.filterOps(ops, { range: L.periodRange("all", NOW), kind: "income" }, NOW).length, 1);
  assert.equal(L.filterOps(ops, { range: month, kind: "all", query: "магнит" }, NOW).length, 1);
  assert.equal(L.filterOps(ops, { range: month, kind: "all", query: "6800" }, NOW).length, 1, "search by amount");
  assert.equal(L.filterOps(ops, { range: month, kind: "all", query: "Products", label: c => (c === "Продукты" ? "Products" : c) }, NOW).length, 2, "search by displayed name");
  const t = L.totals(ops);
  assert.deepEqual(t, { spent: 10200, income: 240000, net: 229800 });
  const cat = L.byCategory(ops);
  assert.deepEqual(cat[0], { cat: "Кафе", sum: 6800 });
  assert.deepEqual(cat[1], { cat: "Продукты", sum: 3400 });
  assert.equal(cat.length, 2, "income is not a category of spending");
});

test("rankCategories: recent use beats old frequency; ties keep order", () => {
  const cats = ["A", "B", "C", "D"];
  const old = i => op(i, "01.08", "A", -1, "card", { ts: at(2026, 8, 1) });
  const ops = [old(1), old(2), old(3), op(10, "05.10", "B", -1, "card", { ts: at(2026, 10, 5) })];
  const r = L.rankCategories(cats, ops, NOW, 14);
  assert.equal(r[0], "B", "one use yesterday outweighs three uses two months ago");
  assert.equal(r[1], "A");
  assert.deepEqual(r.slice(2), ["C", "D"], "unused keep original order");
  assert.deepEqual(L.rankCategories(cats, [], NOW), cats);
});

test("newId is a safe integer and varies with the random part", () => {
  const a = L.newId(NOW, 0), b = L.newId(NOW, 0.5), c = L.newId(NOW, 0.9999);
  assert.ok(Number.isSafeInteger(a) && Number.isSafeInteger(c));
  assert.ok(a < b && b < c);
  assert.equal(c - a, 999);
});

test("budgetStatus: pace, over, none", () => {
  assert.deepEqual(L.budgetStatus(0, 100, NOW), { has: false });
  assert.deepEqual(L.budgetStatus(undefined, 100, NOW), { has: false });
  const s = L.budgetStatus(250000, 15400, NOW);
  assert.equal(s.left, 234600);
  assert.equal(s.daysLeft, 26);
  assert.equal(s.perDay, Math.floor(234600 / 26));
  assert.equal(s.pct, 6);
  assert.equal(s.over, false);
  const o = L.budgetStatus(1000, 1500, NOW);
  assert.equal(o.over, true);
  assert.equal(o.perDay, 0);
  assert.equal(o.ratio, 1, "ring clamps at full");
  assert.equal(o.left, -500);
  const last = L.budgetStatus(3100, 0, at(2026, 10, 31));
  assert.equal(last.perDay, 3100, "last day: everything left is today's");
});

test("balances never invent an opening balance", () => {
  const ops = [op(1, "06.10", "A", -1000, "cash"), op(2, "06.10", "B", 5000, "card"), op(3, "06.10", "C", -200, "card")];
  const none = L.balances({}, ops, NOW);
  assert.equal(none.known, false);
  assert.equal(none.total, 0);
  const some = L.balances({ openCash: 10000 }, ops, NOW);
  assert.equal(some.cash, 9000);
  assert.equal(some.hasCard, false);
  assert.equal(some.total, 9000, "unknown card is not counted");
  const both = L.balances({ openCash: 10000, openCard: 0 }, ops, NOW);
  assert.equal(both.card, 4800);
  assert.equal(both.total, 13800);
  assert.equal(L.balances({ openCash: 0, openCard: 0 }, [], NOW).known, true, "an explicit zero is a known balance");
});

test("a typed balance stays what the person typed: only operations made since then move it", () => {
  const typedAt = at(2026, 10, 6, 12, 0);
  const st = { openCash: 5000, openCashAt: typedAt };
  const before = op(1, "01.10", "A", -1000, "cash", { ts: at(2026, 10, 1, 9, 0) });    // earlier than the balance
  const before2 = op(2, "03.10", "B", -500, "cash", { ts: at(2026, 10, 3, 9, 0) });
  assert.equal(L.balances(st, [before, before2], NOW).cash, 5000, "older operations are already inside the typed amount");
  // editing or deleting an old operation changes nothing
  assert.equal(L.balances(st, [Object.assign({}, before, { sum: -1200 }), before2], NOW).cash, 5000);
  assert.equal(L.balances(st, [before], NOW).cash, 5000);
  // a forgotten operation logged now with an earlier date is not counted twice either
  assert.equal(L.balances(st, [op(3, "05.10", "C", -300, "cash", { ts: at(2026, 10, 5, 20, 0) })], NOW).cash, 5000);
  // operations since the balance was typed do count, income included
  const later = [op(4, "06.10", "D", -400, "cash", { ts: at(2026, 10, 6, 15, 0) }), op(5, "06.10", "E", 150, "cash", { ts: at(2026, 10, 6, 15, 10) })];
  assert.equal(L.balances(st, later, NOW).cash, 4750);
  assert.equal(L.balances(st, later, NOW).card, 0, "the card has no balance and no operations here");
  // no timestamp stored (a balance saved before this field existed): every operation counts, as before
  assert.equal(L.balances({ openCash: 5000 }, [before], NOW).cash, 4000);
  // legacy operations (DD.MM only) are placed by their date
  assert.equal(L.balances(st, [op(6, "01.10", "F", -9, "cash")], NOW).cash, 5000);
});

test("restoreById puts back only the records an action touched", () => {
  const before = [{ id: 1, v: "a" }, { id: 2, v: "b" }, { id: 3, v: "c" }];
  // action changed 2 and removed 3; meanwhile 9 arrived from another device and 1 was edited
  const current = [{ id: 9, v: "new" }, { id: 1, v: "a2" }, { id: 2, v: "B" }];
  const back = L.restoreById(current, before, [2, 3]);
  assert.deepEqual(back.map(x => x.id), [9, 1, 3, 2], "a record that still exists is restored in place, a deleted one returns to its old index");
  assert.deepEqual(back.find(x => x.id === 9), { id: 9, v: "new" }, "the record that arrived meanwhile survives");
  assert.equal(back.find(x => x.id === 1).v, "a2", "so does the edit of an untouched record");
  assert.equal(back.find(x => x.id === 2).v, "b");
  assert.equal(back.find(x => x.id === 3).v, "c");
  // a record that did not exist before is removed again
  assert.deepEqual(L.restoreById([{ id: 5, v: "x" }, { id: 1, v: "a" }], [{ id: 1, v: "a" }], [5]).map(x => x.id), [1]);
});

test("a category called 'constructor' is an ordinary key", () => {
  const ops = [op(1, "06.10", "constructor", -700), op(2, "06.10", "__proto__", -300), op(3, "06.10", "Кафе", -100)];
  const rows = L.byCategory(ops);
  assert.deepEqual(rows.map(r => r.cat + ":" + r.sum), ["constructor:700", "__proto__:300", "Кафе:100"]);
  const used = ops.concat([op(4, "06.10", "constructor", -50)]);
  assert.deepEqual(L.rankCategories(["Кафе", "constructor"], used, NOW), ["constructor", "Кафе"], "the more used category first, however it is called");
  const look = L.catLook("constructor", {}, {});
  assert.equal(typeof look.icon, "string");
  assert.match(look.l, /^#[0-9A-F]{6}$/);
});

test("29 February without a year is found in the last leap year, not 'today'", () => {
  const ts = L.tsFromDdmm("29.02", at(2026, 1, 20, 12, 0));
  assert.equal(new Date(ts).getFullYear(), 2024);
  assert.equal(new Date(ts).getMonth(), 1);
  assert.equal(new Date(ts).getDate(), 29);
  assert.equal(L.tsFromDdmm("31.04", at(2026, 5, 1, 12, 0)), null, "a date that never exists stays invalid");
});

test("debts: due status, repayment clamp and auto-close", () => {
  assert.deepEqual(L.debtDue({}, NOW), { kind: "none", days: 0 });
  assert.deepEqual(L.debtDue({ due: "2026-10-12" }, NOW), { kind: "future", days: 6 });
  assert.deepEqual(L.debtDue({ due: "2026-10-06" }, NOW), { kind: "today", days: 0 });
  assert.deepEqual(L.debtDue({ due: "2026-10-03" }, NOW), { kind: "overdue", days: 3 });
  assert.deepEqual(L.debtDue({ due: "garbage" }, NOW), { kind: "none", days: 0 });
  const d = { id: 1, who: "Айдос", sum: 40000, mine: true, paid: 0, log: [] };
  const r1 = L.applyRepayment(d, 15000, NOW, "x1");
  assert.equal(r1.applied, 15000);
  assert.equal(r1.closed, false);
  assert.equal(L.debtLeft(r1.debt), 25000);
  assert.equal(r1.debt.log.length, 1);
  assert.equal(d.paid, 0, "input is not mutated");
  const r2 = L.applyRepayment(r1.debt, 999999, NOW, "x2");
  assert.equal(r2.applied, 25000, "cannot repay more than is owed");
  assert.equal(r2.closed, true);
  assert.equal(L.applyRepayment(r2.debt, 5, NOW, "x3").applied, 0, "nothing left to repay");
  assert.equal(L.applyRepayment(d, -50, NOW, "x").applied, 0);
  assert.deepEqual(L.debtSideTotals([{ mine: true, sum: 100, paid: 40 }, { mine: false, sum: 70 }]), { owedToMe: 60, iOwe: 70 });
});

test("colour: contrast maths and text picking", () => {
  assert.equal(Math.round(L.contrast("#000000", "#FFFFFF")), 21);
  assert.equal(L.rgbToHex(L.hexToRgb("#abc")), "#AABBCC");
  assert.equal(L.hexToRgb("nope"), null);
  assert.ok(L.contrast("#007AFF", "#FFFFFF") < 4.5, "system blue text on white fails AA (documented)");
  const safe = L.ensureContrast("#007AFF", "#FFFFFF", 4.5);
  assert.ok(L.contrast(safe, "#FFFFFF") >= 4.5, "derived text blue passes AA");
  const lightOnDark = L.ensureContrast("#0A84FF", "#000000", 4.5);
  assert.ok(L.contrast(lightOnDark, "#000000") >= 4.5);
  assert.equal(L.ensureContrast("#000000", "#FFFFFF", 4.5), "#000000", "already fine");
  assert.equal(L.pickText("#FFCC00"), "#1C1C1E", "dark text on yellow");
  assert.equal(L.pickText("#1C1C1E"), "#FFFFFF");
  assert.equal(L.pickText("#007AFF", "#FFFFFF", "#1C1C1E", 3), "#FFFFFF", "white preferred on blue when >= 3:1");
  assert.equal(L.pickText("#FF9500", "#FFFFFF", "#1C1C1E", 3), "#1C1C1E", "orange is too light for white");
});

test("every palette colour and the default look is readable with its chosen text colour", () => {
  L.PALETTE.forEach(p => {
    [p.l, p.d].forEach(hex => {
      const fg = L.pickText(hex, "#FFFFFF", "#1C1C1E", 3);
      assert.ok(L.contrast(hex, fg) >= 3, p.id + " " + hex + " glyph/large text >= 3:1");
    });
  });
});

test("catLook: defaults, custom override, stable fallback", () => {
  assert.deepEqual(L.catLook("Продукты", {}, {}), { l: "#34C759", d: "#30D158", icon: "shopping-cart", id: "green" });
  const custom = L.catLook("Продукты", { "Продукты": "#112233" }, { "Продукты": "wine" });
  assert.equal(custom.l, "#112233");
  assert.equal(custom.icon, "wine");
  const a = L.catLook("Моя категория", {}, {}), b = L.catLook("Моя категория", {}, {});
  assert.deepEqual(a, b, "stable");
  assert.equal(a.icon, "tag");
  assert.notEqual(a.id, "gray", "unknown names never get the neutral gray");
  assert.equal(L.catLook("Прочее", {}, {}).id, "gray");
  L.DEFAULT_CATS.expense.concat(L.DEFAULT_CATS.income).forEach(n => assert.ok(L.DEFAULT_LOOK[n], "default look for " + n));
});

test("plural", () => {
  const f = ["день", "дня", "дней"];
  [[1, "день"], [2, "дня"], [4, "дня"], [5, "дней"], [11, "дней"], [12, "дней"], [21, "день"], [22, "дня"], [25, "дней"], [112, "дней"], [0, "дней"]]
    .forEach(([n, w]) => assert.equal(L.plural("ru", n, f), w, String(n)));
  assert.equal(L.plural("en", 1, ["day", "days"]), "day");
  assert.equal(L.plural("en", 3, ["day", "days"]), "days");
  assert.equal(L.plural("kz", 7, ["күн"]), "күн");
});

test("layers: unique kinds, order, z-index", () => {
  let s = [];
  s = L.pushLayer(s, { kind: "entry", data: 1 });
  s = L.pushLayer(s, { kind: "cats" });
  assert.deepEqual(s.map(l => l.kind), ["entry", "cats"]);
  s = L.pushLayer(s, { kind: "entry", data: 2 });
  assert.equal(s.length, 2, "same kind replaces");
  assert.equal(s[0].data, 2);
  assert.equal(L.topLayer(s).kind, "cats");
  assert.ok(L.layerZ(s, "cats") > L.layerZ(s, "entry"));
  assert.equal(L.layerZ(s, "nope"), 0);
  assert.deepEqual(L.popLayer(s).map(l => l.kind), ["entry"]);
  assert.deepEqual(L.popLayer([]), []);
  assert.deepEqual(L.removeLayer(s, "entry").map(l => l.kind), ["cats"]);
  assert.equal(L.hasLayer(s, "cats"), true);
  assert.equal(L.topLayer([]), null);
});

test("sanitizeState: the gate for outside data", () => {
  assert.equal(L.sanitizeState(null, NOW), null);
  assert.equal(L.sanitizeState([], NOW), null);
  assert.equal(L.sanitizeState({ ops: "x", debts: [] }, NOW), null);
  assert.equal(L.sanitizeState({ ops: new Array(50001).fill({ sum: 1 }), debts: [] }, NOW).ops.length, 50000, "beyond the cap the oldest are cut, the rest is kept");
  assert.equal(L.sanitizeState({ ops: [{ id: 1, date: "01.01", cat: "A", sum: 1e308, pay: "card" }, { id: 2, date: "01.01", cat: "A", sum: -1e9, pay: "card" }, { id: 3, date: "01.01", cat: "A", sum: -999999999, pay: "card" }], debts: [{ id: 4, who: "x", sum: 1e12 }] }, NOW).ops.map(o => o.id).join(), "3", "absurd amounts are dropped");
  const s = L.sanitizeState({
    ops: [
      { id: 1, date: "06.10", cat: "Кафе", note: "x".repeat(500), sum: -1200.4, pay: "wire" },
      { id: 2, date: "99.99", cat: "", sum: 5, pay: "cash" },
      { id: 3, sum: "NaN" },
      { id: 4, date: "01.01", ts: at(2026, 3, 14, 9, 5), cat: "Дом", sum: -10, pay: "card" },
      null, 7
    ],
    debts: [
      { id: 9, who: "", sum: -5, mine: 1, paid: 99, log: [{ sum: 3, date: "01.01", id: "abc", ts: 5 }, { sum: "x" }], due: "2026-10-12" },
      { id: 10, who: "Z", sum: 100, due: "2026-99-99" }
    ],
    closed: [{ id: 11, who: "Q", sum: 10, closedAt: "01.01" }],
    eCats: ["Ok", "", 5, "x".repeat(61)],
    catColors: { "Кафе": "#ff0000", "__proto__": "#00ff00", "bad": "red;}" },
    catIcons: { "Кафе": "coffee", "constructor": "x", "bad": "<script>" },
    hex: "#EC3013", lang: "de", budget: 250000.6, openCash: 0, openCard: "12"
  }, NOW);
  assert.equal(s.ops.length, 3, "invalid sums dropped");
  assert.equal(s.ops[0].note.length, 200);
  assert.equal(s.ops[0].sum, -1200);
  assert.equal(s.ops[0].pay, "card", "unknown payment -> card");
  assert.equal(s.ops[1].date, L.ddmm(NOW), "impossible date -> today");
  assert.equal(s.ops[1].cat, "Прочее");
  assert.equal(s.ops[2].ts, at(2026, 3, 14, 9, 5), "timestamp kept");
  assert.equal(s.ops[2].date, "14.03", "legacy date derived from the timestamp");
  assert.equal(s.debts[0].who, "—");
  assert.equal(s.debts[0].sum, 0);
  assert.equal(s.debts[0].paid, 0, "paid cannot exceed the sum");
  assert.equal(s.debts[0].due, "2026-10-12");
  assert.equal(s.debts[0].log.length, 1);
  assert.equal(s.debts[0].log[0].ts, 5);
  assert.equal(s.debts[1].due, undefined, "bad due date dropped");
  assert.equal(s.closed.length, 1);
  assert.deepEqual(s.eCats, ["Ok"]);
  assert.deepEqual(s.catColors, { "Кафе": "#FF0000" });
  assert.equal(Object.prototype.hasOwnProperty.call(s.catColors, "__proto__"), false);
  assert.deepEqual(s.catIcons, { "Кафе": "coffee" });
  assert.equal(s.hex, "#007AFF", "old default red moves to the new default");
  assert.equal(s.lang, "ru");
  assert.equal(s.budget, 250001);
  assert.equal(s.openCash, 0, "explicit zero is kept");
  assert.equal(s.openCard, undefined, "string is not a number");
  assert.equal(({}).polluted, undefined);
});

test("sanitizeState keeps a user's own accent colour", () => {
  const s = L.sanitizeState({ ops: [], debts: [], hex: "#34c759" }, NOW);
  assert.equal(s.hex, "#34C759");
  assert.equal("budget" in s, false);
  assert.equal("openCash" in s, false);
});

test("backup round trip (v2) and import of a v1 file", () => {
  const state = {
    ops: [op(1, "06.10", "Кафе", -500, "cash", { ts: NOW })], debts: [{ id: 5, who: "A", note: "", sum: 10, mine: true, paid: 0, log: [], due: "2026-10-20" }],
    closed: [], eCats: ["Кафе"], iCats: ["Зарплата"], catColors: { "Кафе": "#FF9500" }, catIcons: { "Кафе": "coffee" },
    hex: "#34C759", lang: "kz", budget: 100000, openCash: 5000, openCard: 0
  };
  const file = JSON.parse(JSON.stringify(L.buildBackup(state)));
  assert.equal(file.v, 2);
  const back = L.sanitizeState(file, NOW);
  assert.equal(back.budget, 100000);
  assert.equal(back.openCard, 0);
  assert.equal(back.ops[0].ts, NOW);
  assert.equal(back.debts[0].due, "2026-10-20");
  assert.equal(back.lang, "kz");
  const v1 = L.sanitizeState({ ops: [{ id: 1, date: "01.10", cat: "A", note: "", sum: -1, pay: "card" }], debts: [], skin: 2, set: 3, light: true }, NOW);
  assert.equal(v1.ops.length, 1);
  assert.equal(v1.budget, undefined);
  assert.equal(v1.ops[0].ts, undefined, "old operations stay without ts; time is derived when needed");
});

test("fill: placeholders", () => {
  assert.equal(L.fill("Spent {a} of {b}", { a: 1, b: "2" }), "Spent 1 of 2");
  assert.equal(L.fill("{x} stays", {}), "{x} stays");
  assert.equal(L.fill("no vars", null), "no vars");
  assert.equal(L.fill("{a}{a}", { a: 0 }), "00");
});
