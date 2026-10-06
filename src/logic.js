// Қalta — pure logic. No DOM, no component state, no globals: everything here is a
// function of its arguments, so it can be tested in Node (tests/logic.test.js) and is
// inlined unchanged into the bundle by tools/build.js.
"use strict";

var NBSP = " ";
var MINUS = "−";
var DAY = 86400000;
var MAX_AMOUNT = 999999999;
var MAX_AMOUNT_DIGITS = 9;

// ───────────────────────────── numbers ─────────────────────────────

function groupDigits(intStr, sep) {
  return String(intStr).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

// Magnitude of n as grouped whole tenge. Digit groups use a no-break space (ru/kk) or a
// comma (en) so an amount can never wrap across two lines.
function fmtInt(n, lang) {
  var v = Math.round(Math.abs(Number(n) || 0));
  return groupDigits(String(v), lang === "en" ? "," : NBSP);
}

function fmtSigned(n, lang, withPlus) {
  var r = Math.round(Number(n) || 0);
  if (r < 0) return MINUS + fmtInt(r, lang);
  if (r > 0 && withPlus) return "+" + fmtInt(r, lang);
  return fmtInt(r, lang);
}

// Amount keypad: the amount is a string of digits with no leading zeros, at most 9 digits.
function keypadPress(cur, key) {
  cur = String(cur || "");
  if (key === "del") return cur.slice(0, -1);
  if (key === "clear") return "";
  if (!/^\d{1,3}$/.test(key)) return cur;
  var next = (cur + key).replace(/^0+/, "");
  if (next.length > MAX_AMOUNT_DIGITS) return cur;
  return next;
}

function amountFromDigits(str) {
  var n = parseInt(String(str || "").replace(/\D/g, "") || "0", 10);
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_AMOUNT);
}

// ───────────────────────────── dates ─────────────────────────────

function pad2(n) { return (n < 10 ? "0" : "") + n; }

function startOfDay(ts) {
  var d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Calendar arithmetic (not +24h), so daylight-saving changes cannot shift a day.
function addDays(ts, n) {
  var d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

function ymd(ts) {
  var d = new Date(ts);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

// "YYYY-MM-DD" -> local noon timestamp, or null when the date does not exist.
function parseYmd(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  var y = +m[1], mo = +m[2], da = +m[3];
  var d = new Date(y, mo - 1, da, 12, 0, 0, 0);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
  return d.getTime();
}

function hhmm(ts) {
  var d = new Date(ts);
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

// "HH:MM" -> minutes since midnight or null
function parseHhmm(s) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  var h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function combineDateTime(dateStr, timeStr, fallbackTs) {
  var base = parseYmd(dateStr);
  if (base == null) return fallbackTs;
  var mins = parseHhmm(timeStr);
  var d = new Date(base);
  if (mins == null) d.setHours(12, 0, 0, 0); else d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d.getTime();
}

// Whole calendar days from b to a (a - b), both local.
function dayDiff(a, b) {
  var da = new Date(a), db = new Date(b);
  var ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  var ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ua - ub) / DAY);
}

function ddmm(ts) {
  var d = new Date(ts);
  return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1);
}

// Legacy operations stored "DD.MM" with no year. A date that would land more than a day in the
// future is read as last year's. Returns local noon, or null for a date that does not exist.
function tsFromDdmm(s, nowTs) {
  var m = /^(\d{1,2})\.(\d{1,2})$/.exec(String(s || ""));
  if (!m) return null;
  var day = +m[1], mon = +m[2];
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  var now = new Date(nowTs);
  function at(year) {
    var d = new Date(year, mon - 1, day, 12, 0, 0, 0);
    return d.getMonth() === mon - 1 && d.getDate() === day ? d.getTime() : null;
  }
  var t = at(now.getFullYear());
  if (t != null && t > nowTs + DAY) t = at(now.getFullYear() - 1);
  else if (t == null) t = at(now.getFullYear() - 1);
  return t;
}

// The moment an operation happened: its own timestamp, else derived from the legacy "DD.MM".
function tsOfOp(op, nowTs) {
  if (op && typeof op.ts === "number" && isFinite(op.ts)) return op.ts;
  var t = tsFromDdmm(op && op.date, nowTs);
  return t == null ? nowTs : t;
}

function clampToNow(ts, nowTs) { return ts > nowTs ? nowTs : ts; }

function daysInMonth(ts) {
  var d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// Days left in the month counting today (so on the last day this is 1).
function daysLeftInMonth(ts) {
  return daysInMonth(ts) - new Date(ts).getDate() + 1;
}

function weekStart(ts) {
  var d = new Date(startOfDay(ts));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

// kind: "week" | "month" | "year" | "all"; offset: 0 = current, -1 = previous ...
// Range is [from, to).
function periodRange(kind, nowTs, offset) {
  offset = offset || 0;
  var d = new Date(nowTs), from, to;
  if (kind === "week") {
    from = addDays(weekStart(nowTs), 7 * offset);
    to = addDays(from, 7);
  } else if (kind === "year") {
    from = new Date(d.getFullYear() + offset, 0, 1).getTime();
    to = new Date(d.getFullYear() + offset + 1, 0, 1).getTime();
  } else if (kind === "all") {
    from = -Infinity; to = Infinity;
  } else {
    from = new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime();
    to = new Date(d.getFullYear(), d.getMonth() + offset + 1, 1).getTime();
  }
  return { kind: kind || "month", offset: offset, from: from, to: to };
}

function localeOf(lang) { return lang === "kz" ? "kk-KZ" : lang === "en" ? "en-US" : "ru-RU"; }

function fmtDate(ts, lang, opts) {
  try { return new Date(ts).toLocaleDateString(localeOf(lang), opts); }
  catch (e) { return new Date(ts).toLocaleDateString(undefined, opts); }
}

function capitalize(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }

function periodLabel(range, lang, nowTs) {
  if (range.kind === "all") return "";
  var from = range.from, last = addDays(range.to, -1);
  if (range.kind === "week") {
    var o = { day: "numeric", month: "short" };
    return fmtDate(from, lang, o) + " – " + fmtDate(last, lang, o);
  }
  if (range.kind === "year") return String(new Date(from).getFullYear());
  var sameYear = new Date(from).getFullYear() === new Date(nowTs).getFullYear();
  var s = fmtDate(from, lang, sameYear ? { month: "long" } : { month: "long", year: "numeric" });
  return capitalize(s);
}

// "Today", "Yesterday", otherwise "Mon, 5 October" (+ year when it is not the current one).
function dayLabel(ts, nowTs, lang, words) {
  var diff = dayDiff(nowTs, ts);
  if (diff === 0) return words.today;
  if (diff === 1) return words.yesterday;
  var sameYear = new Date(ts).getFullYear() === new Date(nowTs).getFullYear();
  var o = sameYear ? { weekday: "short", day: "numeric", month: "long" } : { weekday: "short", day: "numeric", month: "long", year: "numeric" };
  return capitalize(fmtDate(ts, lang, o));
}

// ───────────────────────────── operations ─────────────────────────────

// Safe integer: ms since epoch * 1000 + 0..999, so two devices rarely collide.
function newId(nowTs, rnd) {
  var r = typeof rnd === "number" ? rnd : Math.random();
  return Math.floor(nowTs) * 1000 + Math.min(999, Math.floor(r * 1000));
}

function sortOps(ops, nowTs) {
  return ops.slice().sort(function (a, b) {
    var d = tsOfOp(b, nowTs) - tsOfOp(a, nowTs);
    return d !== 0 ? d : (b.id || 0) - (a.id || 0);
  });
}

function inRange(ts, range) { return ts >= range.from && ts < range.to; }

function matchesQuery(op, q, label) {
  q = String(q || "").trim().toLowerCase();
  if (!q) return true;
  var hay = (String(label || op.cat) + " " + op.cat + " " + (op.note || "") + " " + Math.abs(op.sum)).toLowerCase();
  return hay.indexOf(q) >= 0;
}

// f: { range, query, kind: "all"|"expense"|"income", label: fn(cat)->display name }
function filterOps(ops, f, nowTs) {
  return ops.filter(function (o) {
    if (f.kind === "expense" && !(o.sum < 0)) return false;
    if (f.kind === "income" && !(o.sum > 0)) return false;
    if (f.range && !inRange(tsOfOp(o, nowTs), f.range)) return false;
    return matchesQuery(o, f.query, f.label ? f.label(o.cat) : o.cat);
  });
}

function totals(ops) {
  var spent = 0, income = 0;
  ops.forEach(function (o) { if (o.sum < 0) spent += -o.sum; else income += o.sum; });
  return { spent: spent, income: income, net: income - spent };
}

// Expense totals per category, largest first.
function byCategory(ops) {
  var m = {};
  ops.forEach(function (o) { if (o.sum < 0) m[o.cat] = (m[o.cat] || 0) + -o.sum; });
  return Object.keys(m).map(function (k) { return { cat: k, sum: m[k] }; })
    .sort(function (a, b) { return b.sum - a.sum || (a.cat < b.cat ? -1 : 1); });
}

// Operations grouped by calendar day, newest day first. sum = net of the day.
function groupByDay(ops, nowTs, lang, words) {
  var sorted = sortOps(ops, nowTs), groups = [], idx = {};
  sorted.forEach(function (o) {
    var ts = tsOfOp(o, nowTs), key = ymd(ts);
    if (!(key in idx)) {
      idx[key] = groups.length;
      groups.push({ key: key, ts: ts, label: dayLabel(ts, nowTs, lang, words), sum: 0, count: 0, ops: [] });
    }
    var g = groups[idx[key]];
    g.ops.push(o); g.sum += o.sum; g.count++;
  });
  return groups;
}

// Categories ordered by recency-weighted use (each use counts 0.5^(age/halfLife)); ties keep
// the original order. Used for the quick cards and the category chips.
function rankCategories(cats, ops, nowTs, halfLifeDays) {
  var half = halfLifeDays || 14, score = {};
  ops.forEach(function (o) {
    var age = Math.max(0, dayDiff(nowTs, tsOfOp(o, nowTs)));
    score[o.cat] = (score[o.cat] || 0) + Math.pow(0.5, age / half);
  });
  return cats.map(function (c, i) { return { c: c, i: i, s: score[c] || 0 }; })
    .sort(function (a, b) { return b.s - a.s || a.i - b.i; })
    .map(function (x) { return x.c; });
}

// ───────────────────────────── budget and balances ─────────────────────────────

function budgetStatus(budget, spent, nowTs) {
  if (!(budget > 0)) return { has: false };
  var left = budget - spent;
  var daysLeft = daysLeftInMonth(nowTs);
  return {
    has: true, budget: budget, spent: spent, left: left, over: left < 0,
    ratio: Math.min(1, Math.max(0, spent / budget)), pct: Math.round(spent / budget * 100),
    daysLeft: daysLeft, perDay: left > 0 ? Math.floor(left / daysLeft) : 0
  };
}

function sumByPay(ops, pay) {
  var s = 0;
  ops.forEach(function (o) { if (o.pay === pay) s += o.sum; });
  return s;
}

// Balance = opening balance (typed by the person) + operations of that payment method.
// An account whose opening balance was never set is "unknown": we do not invent a number.
function balances(openCash, openCard, ops) {
  var hasCash = typeof openCash === "number", hasCard = typeof openCard === "number";
  var cash = (hasCash ? openCash : 0) + sumByPay(ops, "cash");
  var card = (hasCard ? openCard : 0) + sumByPay(ops, "card");
  return {
    cash: cash, card: card, hasCash: hasCash, hasCard: hasCard,
    total: (hasCash ? cash : 0) + (hasCard ? card : 0), known: hasCash || hasCard
  };
}

// "I actually have X now": the opening balance that makes the computed balance equal X.
function openingFor(actual, ops, pay) {
  return Math.round(actual) - sumByPay(ops, pay);
}

// ───────────────────────────── debts ─────────────────────────────

function debtLeft(d) { return Math.max(0, (d.sum || 0) - (d.paid || 0)); }

function debtDue(d, nowTs) {
  var due = d && d.due ? parseYmd(d.due) : null;
  if (due == null) return { kind: "none", days: 0 };
  var diff = dayDiff(due, nowTs);
  if (diff < 0) return { kind: "overdue", days: -diff };
  if (diff === 0) return { kind: "today", days: 0 };
  return { kind: "future", days: diff };
}

// A repayment can never exceed what is still owed. Returns the updated debt.
function applyRepayment(debt, amount, ts, id) {
  var eff = Math.min(Math.max(0, Math.round(amount) || 0), debtLeft(debt));
  if (eff <= 0) return { debt: debt, applied: 0, closed: false };
  var nd = Object.assign({}, debt, {
    paid: (debt.paid || 0) + eff,
    log: (debt.log || []).concat([{ sum: eff, date: ddmm(ts), ts: ts, id: id }])
  });
  return { debt: nd, applied: eff, closed: debtLeft(nd) === 0 };
}

function debtSideTotals(debts) {
  var owedToMe = 0, iOwe = 0;
  debts.forEach(function (d) { if (d.mine) owedToMe += debtLeft(d); else iOwe += debtLeft(d); });
  return { owedToMe: owedToMe, iOwe: iOwe };
}

// ───────────────────────────── colour ─────────────────────────────

function hexToRgb(hex) {
  var h = String(hex || "").trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  var n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return "#" + rgb.map(function (v) {
    var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
    return s.length < 2 ? "0" + s : s;
  }).join("").toUpperCase();
}

function isHex(s) { return hexToRgb(s) !== null; }

function relLuminance(rgb) {
  function lin(c) { c = c / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

// WCAG contrast ratio of two hex colours.
function contrast(aHex, bHex) {
  var a = relLuminance(hexToRgb(aHex)), b = relLuminance(hexToRgb(bHex));
  var hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(aHex, bHex, t) {
  var a = hexToRgb(aHex), b = hexToRgb(bHex);
  return rgbToHex([0, 1, 2].map(function (i) { return a[i] + (b[i] - a[i]) * t; }));
}

// The more readable of two candidate text colours on a background. With lightMin the light
// colour wins whenever it reaches that contrast (3 = WCAG "large text"), which keeps white on
// the saturated blues and reds where a pure max-contrast rule would flip to near-black.
function pickText(bgHex, lightHex, darkHex, lightMin) {
  lightHex = lightHex || "#FFFFFF"; darkHex = darkHex || "#1C1C1E";
  if (lightMin && contrast(bgHex, lightHex) >= lightMin) return lightHex;
  return contrast(bgHex, lightHex) >= contrast(bgHex, darkHex) ? lightHex : darkHex;
}

// Moves fg away from bg (darker on a light surface, lighter on a dark one) until the contrast
// reaches min. Used to derive a readable *text* variant of the user's accent colour.
function ensureContrast(fgHex, bgHex, min) {
  if (contrast(fgHex, bgHex) >= min) return rgbToHex(hexToRgb(fgHex));
  var bgLight = relLuminance(hexToRgb(bgHex)) > 0.4;
  var target = bgLight ? "#000000" : "#FFFFFF";
  for (var t = 0.02; t <= 1.0001; t += 0.02) {
    var c = mix(fgHex, target, t);
    if (contrast(c, bgHex) >= min) return c;
  }
  return target;
}

// Approximations of the iOS system colours (light, dark). Apple tunes these between releases.
var PALETTE = [
  { id: "red", l: "#FF3B30", d: "#FF453A" }, { id: "orange", l: "#FF9500", d: "#FF9F0A" },
  { id: "yellow", l: "#FFCC00", d: "#FFD60A" }, { id: "green", l: "#34C759", d: "#30D158" },
  { id: "mint", l: "#00C7BE", d: "#63E6E2" }, { id: "teal", l: "#30B0C7", d: "#40C8E0" },
  { id: "cyan", l: "#32ADE6", d: "#64D2FF" }, { id: "blue", l: "#007AFF", d: "#0A84FF" },
  { id: "indigo", l: "#5856D6", d: "#5E5CE6" }, { id: "purple", l: "#AF52DE", d: "#BF5AF2" },
  { id: "pink", l: "#FF2D55", d: "#FF375F" }, { id: "brown", l: "#A2845E", d: "#AC8E68" },
  { id: "gray", l: "#8E8E93", d: "#98989D" }
];

var DEFAULT_CATS = {
  expense: ["Продукты", "Транспорт", "Кафе", "Дом", "Коммуналка", "Интернет", "Связь", "Аптека", "Врачи", "Одежда", "Обувь", "Дети", "Школа", "Спорт", "Красота", "Подарки", "Развлечения", "Такси", "Бензин", "Ремонт", "Подписки", "Прочее"],
  income: ["Зарплата", "Подработка", "Аренда сдал", "Проценты", "Подарок", "Возврат", "Прочий доход"]
};

// name -> [palette id, icon key]
var DEFAULT_LOOK = {
  "Продукты": ["green", "shopping-cart"], "Транспорт": ["blue", "bus"], "Кафе": ["orange", "coffee"],
  "Дом": ["indigo", "house-line"], "Коммуналка": ["yellow", "lightbulb"], "Интернет": ["cyan", "wifi-high"],
  "Связь": ["teal", "device-mobile"], "Аптека": ["red", "pill"], "Врачи": ["pink", "stethoscope"],
  "Одежда": ["purple", "t-shirt"], "Обувь": ["brown", "sneaker"], "Дети": ["mint", "baby"],
  "Школа": ["cyan", "backpack"], "Спорт": ["mint", "barbell"], "Красота": ["pink", "scissors"],
  "Подарки": ["red", "gift"], "Развлечения": ["purple", "film-slate"], "Такси": ["yellow", "taxi"],
  "Бензин": ["brown", "gas-pump"], "Ремонт": ["brown", "wrench"], "Подписки": ["blue", "repeat"],
  "Прочее": ["gray", "squares-four"],
  "Зарплата": ["green", "briefcase"], "Подработка": ["mint", "laptop"], "Аренда сдал": ["teal", "key"],
  "Проценты": ["blue", "percent"], "Подарок": ["pink", "gift"], "Возврат": ["orange", "arrow-u-up-left"],
  "Прочий доход": ["gray", "plus-circle"]
};

function nameHash(name) {
  var h = 0, s = String(name || "");
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function paletteById(id) {
  for (var i = 0; i < PALETTE.length; i++) if (PALETTE[i].id === id) return PALETTE[i];
  return PALETTE[PALETTE.length - 1];
}

// Look of a category: custom colour/icon from settings, else the built-in one, else a stable
// colour derived from the name. colors: { name: "#hex" }, icons: { name: "icon-key" }.
function catLook(name, colors, icons) {
  var def = DEFAULT_LOOK[name];
  var pal = def ? paletteById(def[0]) : PALETTE[nameHash(name) % (PALETTE.length - 1)];
  var custom = colors && colors[name];
  var hexL = isHex(custom) ? rgbToHex(hexToRgb(custom)) : pal.l;
  var hexD = isHex(custom) ? hexL : pal.d;
  var icon = (icons && icons[name]) || (def ? def[1] : "tag");
  return { l: hexL, d: hexD, icon: icon, id: pal.id };
}

// ───────────────────────────── text helpers ─────────────────────────────

// forms: [one, few, many] for ru; [one, other] for en; kz uses the first form for any number.
function plural(lang, n, forms) {
  n = Math.abs(Math.round(n));
  if (lang === "kz") return forms[0];
  if (lang === "en") return n === 1 ? forms[0] : (forms[1] || forms[0]);
  var m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1] || forms[0];
  return forms[2] || forms[1] || forms[0];
}

// "Spent {a} of {b}" + {a: 1, b: 2} -> "Spent 1 of 2". Unknown placeholders stay as they are.
function fill(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, function (m, k) {
    return vars && Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
  });
}

// ───────────────────────────── layers (navigation stack) ─────────────────────────────

// Each kind of layer appears at most once; pushing an existing kind replaces its data.
function pushLayer(stack, layer) {
  var found = false;
  var next = stack.map(function (l) {
    if (l.kind === layer.kind) { found = true; return layer; }
    return l;
  });
  return found ? next : next.concat([layer]);
}
function popLayer(stack) { return stack.slice(0, -1); }
function removeLayer(stack, kind) { return stack.filter(function (l) { return l.kind !== kind; }); }
function topLayer(stack) { return stack.length ? stack[stack.length - 1] : null; }
function hasLayer(stack, kind) { return stack.some(function (l) { return l.kind === kind; }); }
function layerZ(stack, kind) {
  for (var i = 0; i < stack.length; i++) if (stack[i].kind === kind) return 20 + i * 2;
  return 0;
}

// ───────────────────────────── data gate ─────────────────────────────

// Single gate for everything that enters the app from outside (localStorage, backup file,
// Firestore). Whitelists keys, coerces types, drops junk; returns null when the shape is unusable.
function sanitizeState(d, nowTs) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  if (!Array.isArray(d.ops) || d.ops.length > 20000 || !Array.isArray(d.debts) || d.debts.length > 5000) return null;
  var str = function (v, n) { return typeof v === "string" ? v.slice(0, n) : ""; };
  var fin = function (v) { return typeof v === "number" && isFinite(v); };
  var safeKey = function (k) { return k !== "__proto__" && k !== "constructor" && k !== "prototype"; };
  var money = function (v) { return fin(v) ? Math.max(-MAX_AMOUNT * 100, Math.min(MAX_AMOUNT * 100, Math.round(v))) : null; };

  var ops = d.ops.filter(function (o) { return o && typeof o === "object" && fin(o.sum); }).map(function (o, i) {
    var legacyOk = tsFromDdmm(o.date, nowTs) != null;
    var ts = fin(o.ts) && o.ts > 0 && o.ts < 8.64e15 ? Math.round(o.ts) : null;
    var out = {
      id: fin(o.id) ? o.id : newId(nowTs, (i % 1000) / 1000),
      date: ts != null ? ddmm(ts) : (legacyOk ? str(o.date, 5) : ddmm(nowTs)),
      cat: str(o.cat, 60) || "Прочее",
      note: str(o.note, 200),
      sum: Math.round(o.sum),
      pay: o.pay === "cash" ? "cash" : "card"
    };
    if (ts != null) out.ts = ts;
    return out;
  });

  function debt(x) {
    var sum = Math.max(0, Math.round(x.sum));
    var out = {
      id: fin(x.id) ? x.id : newId(nowTs, 0), who: str(x.who, 60) || "—", note: str(x.note, 200),
      sum: sum, mine: !!x.mine, paid: fin(x.paid) ? Math.min(sum, Math.max(0, Math.round(x.paid))) : 0
    };
    out.log = (Array.isArray(x.log) ? x.log : []).filter(function (p) { return p && fin(p.sum); }).slice(0, 500).map(function (p) {
      var e = { sum: Math.round(p.sum), date: str(p.date, 10) };
      if (typeof p.id === "string" && p.id) e.id = p.id.slice(0, 40);
      if (fin(p.ts) && p.ts > 0) e.ts = Math.round(p.ts);
      return e;
    });
    if (typeof x.closedAt === "string") out.closedAt = str(x.closedAt, 10);
    if (typeof x.reason === "string") out.reason = str(x.reason, 120);
    if (typeof x.due === "string" && parseYmd(x.due) != null) out.due = x.due;
    if (fin(x.ts) && x.ts > 0) out.ts = Math.round(x.ts);
    return out;
  }
  var debts = d.debts.filter(function (x) { return x && typeof x === "object" && fin(x.sum); }).map(debt);
  var closed = (Array.isArray(d.closed) ? d.closed : []).slice(0, 5000).filter(function (x) { return x && typeof x === "object" && fin(x.sum); }).map(debt);

  var cats = function (v) {
    return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string" && x.trim() && x.length <= 60; }).slice(0, 200) : undefined;
  };
  var colors = {};
  if (d.catColors && typeof d.catColors === "object" && !Array.isArray(d.catColors)) {
    Object.keys(d.catColors).slice(0, 300).forEach(function (k) {
      var v = d.catColors[k];
      if (safeKey(k) && typeof v === "string" && isHex(v)) colors[k] = rgbToHex(hexToRgb(v));
    });
  }
  var icons = {};
  if (d.catIcons && typeof d.catIcons === "object" && !Array.isArray(d.catIcons)) {
    Object.keys(d.catIcons).slice(0, 300).forEach(function (k) {
      var v = d.catIcons[k];
      if (safeKey(k) && typeof v === "string" && /^[a-z0-9-]{1,40}$/.test(v)) icons[k] = v;
    });
  }
  var out = {
    ops: ops, debts: debts, closed: closed,
    eCats: cats(d.eCats), iCats: cats(d.iCats),
    lang: d.lang === "kz" || d.lang === "en" ? d.lang : "ru",
    catColors: colors, catIcons: icons,
    lastSync: typeof d.lastSync === "string" ? str(d.lastSync, 10) : null
  };
  if (typeof d.hex === "string" && isHex(d.hex)) {
    var up = d.hex.trim().toUpperCase();
    out.hex = (up === "#EC3013" || up === "#F4C84E") ? "#007AFF" : rgbToHex(hexToRgb(d.hex)); // previous defaults -> new default
  }
  if (fin(d.budget) && d.budget > 0) out.budget = Math.min(MAX_AMOUNT, Math.round(d.budget));
  var oc = money(d.openCash), od = money(d.openCard);
  if (oc !== null) out.openCash = oc;
  if (od !== null) out.openCard = od;
  return out;
}

// ───────────────────────────── backup file ─────────────────────────────

function buildBackup(s) {
  return {
    v: 2, ops: s.ops, debts: s.debts, closed: s.closed || [], eCats: s.eCats, iCats: s.iCats,
    catColors: s.catColors || {}, catIcons: s.catIcons || {}, hex: s.hex, lang: s.lang,
    budget: s.budget, openCash: s.openCash, openCard: s.openCard
  };
}

module.exports = {
  NBSP: NBSP, MINUS: MINUS, DAY: DAY, MAX_AMOUNT: MAX_AMOUNT, PALETTE: PALETTE, DEFAULT_CATS: DEFAULT_CATS, DEFAULT_LOOK: DEFAULT_LOOK,
  groupDigits: groupDigits, fmtInt: fmtInt, fmtSigned: fmtSigned, keypadPress: keypadPress, amountFromDigits: amountFromDigits,
  pad2: pad2, startOfDay: startOfDay, addDays: addDays, ymd: ymd, parseYmd: parseYmd, hhmm: hhmm, parseHhmm: parseHhmm,
  combineDateTime: combineDateTime, dayDiff: dayDiff, ddmm: ddmm, tsFromDdmm: tsFromDdmm, tsOfOp: tsOfOp, clampToNow: clampToNow,
  daysInMonth: daysInMonth, daysLeftInMonth: daysLeftInMonth, weekStart: weekStart, periodRange: periodRange, localeOf: localeOf,
  fmtDate: fmtDate, periodLabel: periodLabel, dayLabel: dayLabel, capitalize: capitalize,
  newId: newId, sortOps: sortOps, inRange: inRange, matchesQuery: matchesQuery, filterOps: filterOps, totals: totals,
  byCategory: byCategory, groupByDay: groupByDay, rankCategories: rankCategories,
  budgetStatus: budgetStatus, sumByPay: sumByPay, balances: balances, openingFor: openingFor,
  debtLeft: debtLeft, debtDue: debtDue, applyRepayment: applyRepayment, debtSideTotals: debtSideTotals,
  hexToRgb: hexToRgb, rgbToHex: rgbToHex, isHex: isHex, relLuminance: relLuminance, contrast: contrast, mix: mix,
  pickText: pickText, ensureContrast: ensureContrast, nameHash: nameHash, paletteById: paletteById, catLook: catLook,
  plural: plural, fill: fill, pushLayer: pushLayer, popLayer: popLayer, removeLayer: removeLayer, topLayer: topLayer, hasLayer: hasLayer, layerZ: layerZ,
  sanitizeState: sanitizeState, buildBackup: buildBackup
};
