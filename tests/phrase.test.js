// node --test tests/phrase.test.js  — the one-line phrase in the entry sheet, on the real component.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { load, makeStorage, type } = require("./helpers/harness.js");
const CAT = require("../src/cat.js");

const MODEL = CAT.load(fs.readFileSync(path.join(__dirname, "..", "cat-model.json"), "utf8"));

function app(data, opts) {
  const h = load({ storage: makeStorage(data ? { "qalta-proto-v1": JSON.stringify(data) } : {}) });
  if (!opts || opts.model !== false) h.c._catModel = MODEL;
  h.vals = () => h.c.renderVals();
  h.form = () => h.c.state.form;
  return h;
}
const enter = c => c.onKey({ key: "Enter", target: { tagName: "INPUT", classList: { contains: x => x === "q-phrase-in" } }, preventDefault() {} });

test("a phrase fills amount, category and note; the hint says the category came from the phrase", () => {
  const { c, vals, form } = app();
  vals().openAdd();
  c.setPhrase("кофе 2800");
  const f = form();
  assert.deepEqual([f.amount, f.cat, f.note, f.dir], ["2800", "Кафе", "кофе", "expense"]);
  assert.match(vals().en.hint, /Кафе · по фразе/);
  assert.equal(vals().en.chips[0].name, "Кафе", "the suggested category is the first chip");
  assert.equal(c.formDirty(), true);
});

test("fields follow the phrase while it is edited, and go back when it no longer says them", () => {
  const { c, vals, form } = app();
  vals().openAdd();
  c.setPhrase("вчера такси 1500 наличными");
  let f = form();
  assert.equal(f.amount, "1500");
  assert.equal(f.cat, "Такси");
  assert.equal(f.pay, "cash");
  assert.equal(f.note, "", "a description that only names the category is not repeated as a note");
  assert.ok(f.ts != null && f.ts < Date.now(), "yesterday");
  c.setPhrase("такси");
  f = form();
  assert.deepEqual([f.amount, f.ts, f.pay], ["", null, "card"], "no amount, no day, no payment in the phrase any more");
  assert.equal(f.cat, "Такси");
});

test("what the person set by hand is theirs: the phrase does not change it", () => {
  const { c, vals, form } = app();
  vals().openAdd();
  c.setPhrase("кофе 2800");
  type(c, "0");
  assert.equal(form().amount, "28000");
  c.setPhrase("кофе 500");
  assert.equal(form().amount, "28000", "keypad after the phrase wins");
  vals().en.chips.find(x => x.name === "Продукты").pick();
  c.setPhrase("такси 500");
  assert.equal(form().cat, "Продукты", "a chip picked by hand wins");
  assert.match(vals().en.hint, /Продукты$/, "and the hint no longer says 'по фразе'");
});

test("an income word in the expense sheet moves the sheet to income; an explicit sign decides by itself", () => {
  const { c, vals, form } = app();
  vals().openAdd();
  c.setPhrase("зп 420 000");
  assert.deepEqual([form().dir, form().cat, form().amount], ["income", "Зарплата", "420000"]);
  c.setPhrase("+5000 Глобус");
  assert.deepEqual([form().dir, form().cat], ["income", null], "a sign says income; an unknown word picks nothing");
});

test("Enter in the phrase saves like the button, and the record carries everything the phrase said", () => {
  const { c, vals } = app();
  vals().openAdd();
  c.setPhrase("Магнум 14 250 каспи");
  enter(c);
  assert.equal(c.state.form, null, "the sheet closed");
  const op = c.state.ops[0];
  assert.deepEqual([op.sum, op.cat, op.note, op.pay], [-14250, "Продукты", "Магнум", "card"]);
  assert.ok(c.state.toast && c.state.toast.undo, "the undo toast is up");
});

test("Enter with a phrase that has no amount keeps the sheet open and says why", () => {
  const { c, vals } = app();
  vals().openAdd();
  c.setPhrase("кофе");
  enter(c);
  assert.ok(c.state.form, "nothing saved");
  assert.equal(vals().en.hintCls, "err");
});

test("an amount over the limit and a day in the future are refused with a message, not changed silently", () => {
  const { c, vals, form } = app();
  vals().openAdd();
  c.setPhrase("звонок 87011234567");
  assert.equal(form().amount, "");
  assert.match(vals().en.hint, /999/);
  const d = new Date(); d.setDate(d.getDate() + 3);
  c.setPhrase("такси 1500 " + String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0"));
  assert.equal(form().ts, null);
  assert.match(vals().en.hint, /будущем/);
});

test("without the network (not loaded yet, or offline) history and category names still work", () => {
  const ops = [{ id: 1, date: "01.10", ts: Date.now() - 86400000, cat: "Продукты", note: "Магнум", sum: -9000, pay: "card" }];
  const { c, vals, form } = app({ ops, debts: [], closed: [] }, { model: false });
  vals().openAdd();
  c.setPhrase("Магнум 14250");
  assert.equal(form().cat, "Продукты", "filed this way before");
  c.setPhrase("в аптеке 3000");
  assert.equal(form().cat, "Аптека", "the category's name");
  c.setPhrase("Glovo 5000");
  assert.equal(form().cat, null, "the network would know; without it nothing is guessed");
});

test("editing an existing record shows no phrase field", () => {
  const ops = [{ id: 1, date: "01.10", ts: Date.now() - 86400000, cat: "Кафе", note: "", sum: -900, pay: "card" }];
  const { c, vals } = app({ ops, debts: [], closed: [] });
  c.openEntry({ mode: "op", edit: c.state.ops[0] });
  assert.equal(vals().en.showPhrase, false);
  c.setPhrase("такси 5000");
  assert.equal(c.state.form.amount, "900", "and a stray call does nothing");
});
