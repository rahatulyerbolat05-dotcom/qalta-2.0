// Қalta — one-line entry: "кофе 2800", "вчера такси 1 500 наличными", "+420 000 зарплата", "2,5к продукты".
// Pure functions, no DOM, no other module: the same file runs in the app, in a chat bot and in tests
// (tests/parse.test.js). Rules read the amount, the day, the time, the payment and an explicit sign;
// whatever words are left describe the purchase and go to the category model (cat.js).
"use strict";

var MAX_AMOUNT = 999999999;

function pad2(n) { return (n < 10 ? "0" : "") + n; }
function ymdOf(ts) { var d = new Date(ts); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function hhmmOf(ts) { var d = new Date(ts); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
function daysAgo(nowTs, k) { var d = new Date(nowTs); d.setDate(d.getDate() - k); return ymdOf(d.getTime()); }
// local date that exists, or null (31.02 does not)
function validDate(y, m, d) {
  var t = new Date(y, m - 1, d, 12, 0, 0, 0);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d ? t.getTime() : null;
}

// A day and month without a year: "30.12" typed on 2 January is last December; "12.10" typed on 7 October
// is a day ahead of today (the caller refuses it as a future date), not a year ago.
function lastYearIfFar(ts, nowTs, mo, d) {
  if (ts == null || ts <= nowTs + 60 * 86400000) return ts;
  return validDate(new Date(nowTs).getFullYear() - 1, mo, d);
}

// Words are compared lowercased with ё as е.
function low(s) { return String(s).toLowerCase().replace(/ё/g, "е"); }

var MULT = {
  "к": 1e3, "k": 1e3, "тыс": 1e3, "тысяч": 1e3, "тысяча": 1e3, "тысячи": 1e3, "тыщ": 1e3, "тыщи": 1e3, "тыща": 1e3, "мың": 1e3,
  "млн": 1e6, "миллион": 1e6, "миллиона": 1e6, "миллионов": 1e6, "mln": 1e6, "m": 1e6, "лям": 1e6, "ляма": 1e6, "лямов": 1e6, "кк": 1e6, "kk": 1e6
};
var CURRENCY = { "₸": 1, "тг": 1, "тнг": 1, "тенге": 1, "теңге": 1, "tg": 1, "kzt": 1, "tenge": 1 };
var CASH = { "наличные": 1, "наличными": 1, "наличка": 1, "наличкой": 1, "наличку": 1, "нал": 1, "налом": 1, "наликом": 1, "нала": 1,
  "кэш": 1, "кеш": 1, "кэшем": 1, "кешем": 1, "cash": 1, "қолма-қол": 1, "қолма-қолмен": 1 };
var CARD = { "карта": 1, "картой": 1, "карту": 1, "карте": 1, "карточкой": 1, "карточка": 1, "кредиткой": 1, "безнал": 1, "безналом": 1,
  "card": 1, "kaspi": 1, "каспи": 1, "картамен": 1, "карточкамен": 1 };
var DIR = { "доход": "income", "приход": "income", "income": "income", "кіріс": "income", "расход": "expense", "expense": "expense", "шығыс": "expense" };
var REL = { "сегодня": 0, "today": 0, "бүгін": 0, "вчера": 1, "yesterday": 1, "кеше": 1, "позавчера": 2 };
// 0 = Sunday, as Date#getDay
var WEEKDAY = {
  "воскресенье": 0, "понедельник": 1, "вторник": 2, "среда": 3, "среду": 3, "четверг": 4, "пятница": 5, "пятницу": 5, "суббота": 6, "субботу": 6,
  "sunday": 0, "monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4, "friday": 5, "saturday": 6,
  "жексенбі": 0, "дүйсенбі": 1, "сейсенбі": 2, "сәрсенбі": 3, "бейсенбі": 4, "жұма": 5, "сенбі": 6
};
// Month names: whole words or common short forms only ("мар" yes, "маршрутка" no).
var MONTHS = [
  /^(январ[ьяе]|янв|january|jan|қаңтар)$/, /^(феврал[ьяе]|фев|february|feb|ақпан)$/, /^(март[ае]?|мар|march|mar|наурыз)$/,
  /^(апрел[ьяе]|апр|april|apr|сәуір)$/, /^(ма[йяе]|may|мамыр)$/, /^(июн[ьяе]?|june|jun|маусым)$/, /^(июл[ьяе]?|july|jul|шілде)$/,
  /^(август[ае]?|авг|august|aug|тамыз)$/, /^(сентябр[ьяе]|сен|сент|september|sep|sept|қыркүйек)$/,
  /^(октябр[ьяе]|окт|october|oct|қазан)$/, /^(ноябр[ьяе]|ноя|нояб|november|nov|қараша)$/, /^(декабр[ьяе]|дек|december|dec|желтоқсан)$/
];
function monthOf(w) { for (var i = 0; i < MONTHS.length; i++) if (MONTHS[i].test(w)) return i + 1; return 0; }
// Small words that only glue a recognised part to the phrase ("в пятницу", "по карте", "за такси").
var GLUE = { "в": 1, "во": 1, "на": 1, "за": 1, "по": 1, "для": 1, "с": 1, "со": 1, "у": 1, "к": 1, "и": 1, "at": 1, "on": 1, "for": 1, "in": 1, "by": 1, "to": 1 };

// Tokens: numbers, words (letters with inner hyphens/apostrophes), single other characters.
var TOKEN = /(\d+)|([\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*)|([^\s\d\p{L}\p{M}])/gu;
function lex(text) {
  var out = [], m, end = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    out.push({ kind: m[1] ? "num" : m[2] ? "word" : "sym", v: m[0], lo: low(m[0]), gap: text.slice(end, m.index), used: false });
    end = m.index + m[0].length;
  }
  return out;
}

// parsePhrase(text, nowTs) -> { amount, tooBig, dir, ymd, time, pay, rest }
//   amount  whole tenge (0 when the phrase has none), tooBig when a number was there but exceeds the limit
//   dir     "income" | "expense" | null (null: the phrase does not say)
//   ymd     "YYYY-MM-DD" | null, time "HH:MM" | null — as written; see phraseTs for the moment it means
//   pay     "cash" | "card" | null
//   rest    the words that are left, as typed (the description)
function parsePhrase(text, nowTs) {
  var src = String(text == null ? "" : text).slice(0, 500).replace(/[     ]/g, " ").replace(/[−‒–—]/g, "-");
  var tk = lex(src), r = { amount: 0, tooBig: false, dir: null, ymd: null, time: null, pay: null, rest: "" };
  var i, t, n;
  var isNum = k => tk[k] && tk[k].kind === "num";
  var tight = k => tk[k] && tk[k].gap === "";                     // no space before token k
  var useGlue = k => { if (tk[k] && tk[k].kind === "word" && GLUE[tk[k].lo] && !tk[k].used) tk[k].used = true; };

  // 1. time "9:30", "в 21:05"
  for (i = 0; i + 2 < tk.length; i++) {
    if (isNum(i) && !tk[i].used && tk[i + 1].v === ":" && tight(i + 1) && isNum(i + 2) && tight(i + 2) && tk[i + 2].v.length === 2) {
      var h = +tk[i].v, mi = +tk[i + 2].v;
      if (tk[i].v.length <= 2 && h <= 23 && mi <= 59 && !r.time) {
        r.time = pad2(h) + ":" + pad2(mi);
        tk[i].used = tk[i + 1].used = tk[i + 2].used = true; useGlue(i - 1);
      }
    }
  }
  // 2. numeric dates "12.10", "12/10", "12.10.2026" (not "1.5к": a multiplier makes it an amount)
  for (i = 0; i + 2 < tk.length; i++) {
    if (!isNum(i) || tk[i].used || !(tk[i + 1].v === "." || tk[i + 1].v === "/") || !tight(i + 1) || !isNum(i + 2) || !tight(i + 2)) continue;
    if (tk[i].v.length > 2 || tk[i + 2].v.length > 2) continue;
    var after = tk[i + 3], yTok = null;
    if (after && (after.v === "." || after.v === "/") && tight(i + 3) && isNum(i + 4) && tight(i + 4) && (tk[i + 4].v.length === 2 || tk[i + 4].v.length === 4)) yTok = tk[i + 4];
    var next = yTok ? tk[i + 5] : after;
    if (next && next.kind === "word" && MULT[next.lo] !== undefined) continue;
    var d = +tk[i].v, mo = +tk[i + 2].v, y = yTok ? +yTok.v : 0;
    if (y && y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
    var ts = y ? validDate(y, mo, d) : validDate(new Date(nowTs).getFullYear(), mo, d);
    if (ts == null) continue;
    if (!y) ts = lastYearIfFar(ts, nowTs, mo, d);
    if (ts == null || r.ymd) continue;
    r.ymd = ymdOf(ts);
    tk[i].used = tk[i + 1].used = tk[i + 2].used = true;
    if (yTok) { tk[i + 3].used = true; yTok.used = true; }
    useGlue(i - 1);
  }
  // 3. words: relative days, weekdays, month names next to a day number, payment, explicit side
  for (i = 0; i < tk.length; i++) {
    t = tk[i];
    if (t.used || t.kind !== "word") continue;
    if (REL[t.lo] !== undefined && !r.ymd) { r.ymd = daysAgo(nowTs, REL[t.lo]); t.used = true; continue; }
    if (t.lo === "алдыңғы" && tk[i + 1] && tk[i + 1].lo === "күні" && !r.ymd) { r.ymd = daysAgo(nowTs, 2); t.used = tk[i + 1].used = true; continue; }
    if (WEEKDAY[t.lo] !== undefined && !r.ymd) {
      var back = (new Date(nowTs).getDay() - WEEKDAY[t.lo] + 7) % 7;
      r.ymd = daysAgo(nowTs, back); t.used = true; useGlue(i - 1); continue;
    }
    var mon = monthOf(t.lo);
    if (mon && !r.ymd) {
      var dayTok = isNum(i - 1) && !tk[i - 1].used ? tk[i - 1] : isNum(i + 1) && !tk[i + 1].used ? tk[i + 1] : null;
      if (dayTok && dayTok.v.length <= 2) {
        var dd = lastYearIfFar(validDate(new Date(nowTs).getFullYear(), mon, +dayTok.v), nowTs, mon, +dayTok.v);
        if (dd != null) { r.ymd = ymdOf(dd); t.used = dayTok.used = true; useGlue(tk.indexOf(dayTok) - 1); continue; }
      }
    }
    if (CASH[t.lo] && !r.pay) { r.pay = "cash"; t.used = true; useGlue(i - 1); continue; }
    if (CARD[t.lo] && !r.pay) { r.pay = "card"; t.used = true; useGlue(i - 1); continue; }
    if (DIR[t.lo] && !r.dir) { r.dir = DIR[t.lo]; t.used = true; continue; }
  }
  // 4. amounts: "2800", "2 800", "2.800", "2,5к", "1.5 млн", "+420000", "500₸"
  var cands = [];
  for (i = 0; i < tk.length; i++) {
    if (!isNum(i) || tk[i].used) continue;
    var parts = [tk[i]], j = i + 1, digits = tk[i].v, frac = "";
    // thousands groups: one separator kind, every later group exactly three digits
    if (tk[i].v.length <= 3) {
      var sep = null;
      while (tk[j]) {
        var gapSep = tk[j].kind === "num" && tk[j].gap === " " && tk[j].v.length === 3 && (sep === null || sep === " ");
        var symSep = (tk[j].v === "." || tk[j].v === ",") && tight(j) && isNum(j + 1) && tight(j + 1) && tk[j + 1].v.length === 3 && !tk[j + 1].used && (sep === null || sep === tk[j].v);
        if (gapSep && !tk[j].used) { sep = " "; parts.push(tk[j]); digits += tk[j].v; j++; }
        else if (symSep) { sep = tk[j].v; parts.push(tk[j], tk[j + 1]); digits += tk[j + 1].v; j += 2; }
        else break;
      }
    }
    // a decimal part ("2,5к", "1.5 млн", "2800.50")
    if (parts.length === 1 && tk[j] && (tk[j].v === "." || tk[j].v === ",") && tight(j) && isNum(j + 1) && tight(j + 1) && !tk[j + 1].used) {
      frac = tk[j + 1].v; parts.push(tk[j], tk[j + 1]); j += 2;
    }
    var mult = 1, marked = false;
    // short multipliers only when attached ("5к" is 5000, "500 к обеду" is not 500 000)
    if (tk[j] && tk[j].kind === "word" && MULT[tk[j].lo] !== undefined && !tk[j].used && (tk[j].lo.length > 2 || tight(j))) { mult = MULT[tk[j].lo]; parts.push(tk[j]); marked = true; j++; }
    else if (frac && frac.length === 3) { digits += frac; frac = ""; }   // "2.800" with no multiplier: a thousands group
    if (tk[j] && CURRENCY[tk[j].lo] && !tk[j].used) { parts.push(tk[j]); marked = true; j++; }
    var sign = 0, s = tk[i - 1];
    // a sign touches its number and stands apart from the word before it ("кофе -500", not "аи-92")
    if (s && !s.used && (s.v === "+" || s.v === "-") && tight(i) && (i - 1 === 0 || s.gap !== "")) { sign = s.v === "+" ? 1 : -1; parts.unshift(s); marked = true; }
    var value = Math.round(parseFloat(digits + (frac ? "." + frac : "")) * mult);
    cands.push({ value: value, parts: parts, marked: marked, sign: sign });
    i = j - 1;
  }
  if (cands.length) {
    var pool = cands.filter(c => c.marked);
    if (!pool.length) pool = cands;
    var best = pool.reduce((a, b) => (b.value > a.value ? b : a));
    best.parts.forEach(p => { p.used = true; });
    if (!(best.value > 0)) r.amount = 0;
    else if (best.value > MAX_AMOUNT) { r.amount = 0; r.tooBig = true; }
    else r.amount = best.value;
    if (best.sign) r.dir = best.sign > 0 ? "income" : "expense";
    if (cands.length === 1 || best.marked) {
      // the currency word after an amount ("500 тенге") is never part of the description
      for (n = 0; n < tk.length; n++) if (!tk[n].used && tk[n].kind !== "num" && CURRENCY[tk[n].lo]) tk[n].used = true;
    }
  }
  // 5. what is left: words and stray numbers ("2 кофе", "аи 92"), without glue at the edges
  var left = tk.filter(x => !x.used && (x.kind !== "sym" || /[&#%@]/.test(x.v)));
  while (left.length && left[0].kind === "word" && GLUE[left[0].lo]) left.shift();
  while (left.length && left[left.length - 1].kind === "word" && GLUE[left[left.length - 1].lo]) left.pop();
  r.rest = left.map(x => x.v).join(" ").trim().slice(0, 200);
  return r;
}

// The moment a parsed phrase means, or null for "now". A day without a time keeps the current time of day
// (as picking "yesterday" in the date sheet does); a moment in the future is not accepted (future: true).
function phraseTs(p, nowTs) {
  if (!p || (!p.ymd && !p.time)) return { ts: null, future: false };
  var today = ymdOf(nowTs), day = p.ymd || today;
  if (day === today && !p.time) return { ts: null, future: false };
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day), hm = (p.time || hhmmOf(nowTs)).split(":");
  var t = new Date(+m[1], +m[2] - 1, +m[3], +hm[0], +hm[1], 0, 0).getTime();
  if (t > nowTs) return { ts: null, future: true };
  return { ts: t, future: false };
}

module.exports = { parsePhrase: parsePhrase, phraseTs: phraseTs, lex: lex, low: low };
