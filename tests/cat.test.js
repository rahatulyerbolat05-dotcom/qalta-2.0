// node --test tests/cat.test.js  — category for a description: history, category names, the small network.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const CAT = require("../src/cat.js");
const QL = require("../src/logic.js");
const LEX = require("../tools/ml/lexicon.js");

const ROOT = path.join(__dirname, "..");
const raw = fs.readFileSync(path.join(ROOT, "cat-model.json"), "utf8");
const model = CAT.load(raw);
const CATS = { expense: QL.DEFAULT_CATS.expense, income: QL.DEFAULT_CATS.income };
const ask = (text, extra) => CAT.suggest(Object.assign({ text, dir: "expense", cats: CATS, model }, extra || {}));

test("the shipped model fits together, is small and matches the vocabulary it was trained on", () => {
  assert.ok(raw.length < 150 * 1024, "model file " + Math.round(raw.length / 1024) + " KB");
  assert.equal(model.emb.length, model.B * model.D);
  model.labels.forEach(l => assert.ok(CATS.expense.includes(l) || CATS.income.includes(l), l + " is a built-in category"));
  model.labels.forEach(l => assert.equal(model.dir[l], CATS.income.includes(l) ? "income" : "expense", l));
  const words = Object.values(LEX.expense).concat(Object.values(LEX.income)).reduce((a, t) => a + t.length, 0);
  assert.equal(JSON.parse(raw).trained.terms, words, "tools/ml/lexicon.js changed: run node tools/ml/train.js");
  assert.ok(fs.readFileSync(path.join(ROOT, "docs", "ML-REPORT.md"), "utf8").includes("Незнакомые слова"), "the training report is there");
});

test("a broken or foreign model file is refused instead of giving nonsense", () => {
  assert.throws(() => CAT.load("{}"));
  const j = JSON.parse(raw); j.W2 = j.b2;
  assert.throws(() => CAT.load(j));
});

test("everyday words get their category picked; the network is confident only about words it was taught", () => {
  const cases = { "кофе": "Кафе", "Магнум": "Продукты", "хлеб и молоко": "Продукты", "обед": "Кафе", "Glovo": "Кафе", "Netflix": "Подписки",
    "заправился": "Бензин", "стрижка": "Красота", "шиномонтаж": "Ремонт", "абонемент в зал": "Спорт", "яндекс го": "Такси", "кеше дәріхана": "Аптека",
    "кофе в зернах": "Продукты" };
  for (const [text, cat] of Object.entries(cases)) {
    const g = ask(text);
    assert.equal(g.cat, cat, text + " -> " + JSON.stringify(g));
    assert.equal(g.dir, "expense", text);
  }
});

test("a category's name in the description is enough, inflected too, and works for the person's own categories", () => {
  assert.deepEqual([ask("в аптеке").cat, ask("в аптеке").why], ["Аптека", "name"]);
  assert.equal(ask("продуктов на неделю").cat, "Продукты");
  const own = { expense: CATS.expense.concat(["Собака"]), income: CATS.income };
  assert.deepEqual([ask("корм собаке", { cats: own }).cat, ask("корм собаке", { cats: own }).why], ["Собака", "name"]);
  assert.equal(CAT.namesCategory(CAT.words("домой"), "Дом"), false, "a short name must match the whole word");
});

test("an income word typed into an expense sheet moves to income only when it is clear", () => {
  assert.deepEqual([ask("зп").cat, ask("зп").dir], ["Зарплата", "income"]);
  assert.deepEqual([ask("кешбэк").cat, ask("кешбэк").dir], ["Возврат", "income"]);
  assert.equal(ask("подарили", { dir: "income" }).cat, "Подарок", "one network label covers the gift given and the gift received");
});

test("an unknown word is never picked by the network; the person chooses from ranked chips", () => {
  for (const text of ["Глобус", "мәрмелад", "вода", "xyzzy"]) {
    const g = ask(text);
    assert.equal(g.cat, null, text + " -> " + g.cat);
    assert.ok(g.ranked.length >= 1 && g.ranked.length <= 5);
    g.ranked.forEach(c => assert.ok(CATS.expense.includes(c), c));
  }
  assert.deepEqual(ask("").ranked, []);
});

test("the person's history wins over the network, for the description and for single words", () => {
  const ops = [
    { id: 1, cat: "Продукты", note: "Глобус", sum: -7000 },
    { id: 2, cat: "Продукты", note: "Глобус", sum: -3000 },
    { id: 3, cat: "Развлечения", note: "кофе с Асель", sum: -2000 },
    { id: 4, cat: "Развлечения", note: "кофе с Асель", sum: -2500 },
    { id: 5, cat: "Дети", note: "секция Алихана", sum: -15000 }
  ];
  const mem = CAT.memory(ops);
  assert.deepEqual([ask("глобус", { mem }).cat, ask("глобус", { mem }).why], ["Продукты", "history"]);
  assert.equal(ask("кофе с Асель", { mem }).cat, "Развлечения", "the same words filed elsewhere before beat the network's Кафе");
  assert.equal(ask("Алихана футбол", { mem }).ranked[0], "Дети", "a single word seen before ranks its category first");
  assert.equal(ask("кофе", { mem }).cat, "Кафе", "a different description still goes to the network");
});

test("a category the person deleted is never suggested", () => {
  const cats = { expense: CATS.expense.filter(c => c !== "Кафе"), income: CATS.income };
  const g = ask("кофе", { cats });
  assert.notEqual(g.cat, "Кафе");
  assert.ok(!g.ranked.includes("Кафе"));
});

test("hostile text and records cannot break the index", () => {
  const mem = CAT.memory([{ id: 1, cat: "constructor", note: "__proto__ toString", sum: -1 }, { id: 2, cat: "Кафе", note: "hasOwnProperty", sum: -1 }, null, { note: 5 }]);
  assert.doesNotThrow(() => ask("__proto__ constructor toString hasOwnProperty", { mem }));
  assert.equal(Object.getPrototypeOf(mem.notes), null);
  assert.ok(CAT.features("x".repeat(10000), 4096).length < 200);
});
