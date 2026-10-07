// node --test tests/parse.test.js  — one-line entry: amount, day, time, payment, sign, what is left.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../src/parse.js");

const NOW = new Date(2026, 9, 7, 11, 30).getTime();   // Wednesday 7 October 2026, 11:30 local
const at = (y, mo, d, h = 11, mi = 30) => new Date(y, mo - 1, d, h, mi).getTime();
const parse = s => P.parsePhrase(s, NOW);
const pick = (r, keys) => keys.reduce((o, k) => Object.assign(o, { [k]: r[k] }), {});

test("amounts as people type them", () => {
  const cases = {
    "кофе 2800": 2800, "кофе 2 800": 2800, "кофе 2.800": 2800, "кофе 2,800": 2800, "1 500 000 машина": 1500000,
    "2,5к продукты": 2500, "5к": 5000, "1.5 млн машина": 1500000, "2 тыс такси": 2000, "3 мың нан": 3000,
    "500₸ хлеб": 500, "3500 тг аптека": 3500, "2800.50 бензин": 2801, "кофе2800": 2800
  };
  for (const [text, amount] of Object.entries(cases)) assert.equal(parse(text).amount, amount, text);
});

test("of several numbers the amount is the marked one, else the largest; the rest stays in the description", () => {
  assert.deepEqual(pick(parse("2 кофе 1400"), ["amount", "rest"]), { amount: 1400, rest: "2 кофе" });
  assert.deepEqual(pick(parse("бензин аи-92 15000"), ["amount", "dir", "rest"]), { amount: 15000, dir: null, rest: "бензин аи 92" }, "a hyphen inside a word is not a minus");
  assert.equal(parse("кофе 500 к обеду").amount, 500, "a detached к is a word, not a thousand");
  assert.equal(parse("кофе 500 к обеду").rest, "кофе к обеду");
});

test("an amount above the limit is refused, not cut", () => {
  const r = parse("звонок 87011234567");
  assert.equal(r.amount, 0);
  assert.equal(r.tooBig, true);
});

test("a sign or a side word decides income or expense; otherwise the phrase does not say", () => {
  assert.equal(parse("+420 000 зарплата").dir, "income");
  assert.equal(parse("кофе -500").dir, "expense");
  assert.equal(parse("кешбэк +3 200").dir, "income");
  assert.equal(parse("доход 5000 подработка").dir, "income");
  assert.equal(parse("расход 700 вода").rest, "вода");
  assert.equal(parse("кофе - 500").dir, null, "a dash with spaces is punctuation");
  assert.equal(parse("кофе 500").dir, null);
});

test("days: relative words in three languages, weekdays, dates with and without a month name", () => {
  assert.equal(parse("вчера такси 1500").ymd, "2026-10-06");
  assert.equal(parse("кеше дәрі 3500").ymd, "2026-10-06");
  assert.equal(parse("coffee 1,200 yesterday").ymd, "2026-10-06");
  assert.equal(parse("позавчера кино").ymd, "2026-10-05");
  assert.equal(parse("в пятницу кино 9000").ymd, "2026-10-02");
  assert.equal(parse("в среду обед").ymd, "2026-10-07", "today's weekday is today");
  assert.equal(parse("12.09 такси 1500").ymd, "2026-09-12");
  assert.equal(parse("3 октября подарок 22000").ymd, "2026-10-03");
  assert.equal(parse("подарок 30 sep 5000").ymd, "2026-09-30");
  assert.equal(parse("12 маршрутка 300").ymd, null, "a word that only starts like a month is not one");
});

test("a day ahead is not moved a year back; only a far one is (30.12 typed in January)", () => {
  const ahead = parse("12.10 такси 1500");
  assert.equal(ahead.ymd, "2026-10-12");
  assert.deepEqual(P.phraseTs(ahead, NOW), { ts: null, future: true });
  const jan = new Date(2026, 0, 2, 10, 0).getTime();
  assert.equal(P.parsePhrase("30.12 подарки 5000", jan).ymd, "2025-12-30");
});

test("the moment: now unless a day or time is given; a day keeps the time of day; the future is refused", () => {
  assert.deepEqual(P.phraseTs(parse("кофе 500"), NOW), { ts: null, future: false });
  assert.deepEqual(P.phraseTs(parse("сегодня кофе 500"), NOW), { ts: null, future: false });
  assert.deepEqual(P.phraseTs(parse("вчера кофе 500"), NOW), { ts: at(2026, 10, 6), future: false });
  assert.deepEqual(P.phraseTs(parse("кофе 500 в 9:15"), NOW), { ts: at(2026, 10, 7, 9, 15), future: false });
  assert.deepEqual(P.phraseTs(parse("кофе 500 в 21:00"), NOW), { ts: null, future: true });
});

test("payment words, glue words and currency names never end up in the description", () => {
  const r = parse("вчера по карте за такси 1 500");
  assert.deepEqual(pick(r, ["pay", "rest", "amount"]), { pay: "card", rest: "такси", amount: 1500 });
  assert.equal(parse("Магнум 14250 каспи").pay, "card");
  assert.equal(parse("обед 4600 наличными").pay, "cash");
  assert.equal(parse("кеше дәрі 3500 қолма-қол").pay, "cash");
  assert.equal(parse("хлеб 300 тенге").rest, "хлеб");
});

test("odd input never throws and gives an empty result", () => {
  for (const x of [null, undefined, "", "   ", "!!!", "+", "-", ".", "12.", ":30", "a".repeat(5000), "__proto__ constructor 5"]) {
    const r = P.parsePhrase(x, NOW);
    assert.equal(typeof r.amount, "number");
    assert.equal(typeof r.rest, "string");
    assert.ok(r.rest.length <= 200);
  }
  assert.equal(P.parsePhrase("__proto__ constructor 5", NOW).amount, 5);
});
