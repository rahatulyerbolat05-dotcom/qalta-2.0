// node --test tests/bot.test.js  — the Telegram bot with a fake Telegram and a fake Firestore.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createBot, sameSecret, DAILY_LIMIT } = require("../bot/core.js");
const CAT = require("../src/cat.js");
const Sync = require("../sync-engine.js");

const MODEL = CAT.load(fs.readFileSync(path.join(__dirname, "..", "cat-model.json"), "utf8"));
const RULES = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
const OP_FIELDS = /function validOp[\s\S]*?hasOnly\(\[([^\]]*)\]/.exec(RULES)[1].split(",").map(s => s.trim().replace(/'/g, ""));

const clone = x => JSON.parse(JSON.stringify(x));
class FakeDb {
  constructor() { this.docs = new Map(); this.fail = null; }
  async get(p) { return this.docs.has(p) ? { id: p.split("/").pop(), data: clone(this.docs.get(p)) } : null; }
  async set(p, d) { if (this.fail && this.fail(p)) throw new Error("write refused"); this.docs.set(p, clone(d)); }
  async del(p) { this.docs.delete(p); }
  async query(parent, coll, q) {
    const pre = parent + "/" + coll + "/";
    let out = [...this.docs.entries()].filter(([k]) => k.startsWith(pre) && !k.slice(pre.length).includes("/")).map(([k, v]) => ({ id: k.slice(pre.length), data: clone(v) }));
    if (q && q.where) out = out.filter(d => typeof d.data[q.where[0]] === "number" && d.data[q.where[0]] >= q.where[2]);
    if (q && q.orderBy) out = out.filter(d => d.data[q.orderBy] !== undefined).sort((a, b) => (a.data[q.orderBy] - b.data[q.orderBy]) * (q.desc ? -1 : 1));
    if (q && q.limit) out = out.slice(0, q.limit);
    return out;
  }
  ops(uid) { return [...this.docs.entries()].filter(([k]) => k.startsWith("users/" + uid + "/ops/")).map(([, v]) => v); }
}
class FakeTg {
  constructor() { this.out = []; }
  async send(chat, text, kb) { this.out.push({ m: "send", chat, text, kb }); return { message_id: this.out.length }; }
  async edit(chat, id, text, kb) { this.out.push({ m: "edit", chat, id, text, kb }); }
  async answer(id) { this.out.push({ m: "answer", id }); }
  last() { return this.out.filter(x => x.m !== "answer").slice(-1)[0]; }
}

// 7 October 2026, 13:30 in Almaty (UTC+5)
const T0 = Date.UTC(2026, 9, 7, 8, 30);
function setup(opts) {
  opts = opts || {};
  const db = new FakeDb(), tg = new FakeTg();
  let clock = opts.now || T0;
  const bot = createBot({ tg, db, model: MODEL, now: () => clock });
  const user = { id: 777, language_code: "ru" };
  let mid = 100;
  const msg = text => bot.handleUpdate({ update_id: mid, message: { message_id: mid++, date: Math.floor(clock / 1000), chat: { id: 777, type: "private" }, from: user, text } });
  const tap = (data, mid) => bot.handleUpdate({ update_id: 2, callback_query: { id: "cb", from: user, data, message: { message_id: mid || 9, chat: { id: 777, type: "private" } } } });
  const link = async (settings) => {
    db.docs.set("botLinks/abcdefghijklmnop0123", { uid: "u1", exp: clock + 600000, tz: "Asia/Almaty" });
    if (settings) db.docs.set("users/u1/meta/settings", Object.assign({ _u: 1, _d: "web" }, settings));
    await msg("/start abcdefghijklmnop0123");
  };
  return { db, tg, bot, msg, tap, link, setNow: t => { clock = t; } };
}
const lastBtn = (tg, i) => tg.last().kb[0][i || 0].data;

test("someone who is not linked gets instructions and nothing is written", async () => {
  const { db, tg, msg } = setup();
  await msg("кофе 2800");
  assert.match(tg.last().text, /Настройки → Telegram-бот/);
  assert.equal([...db.docs.keys()].length, 0);
});

test("linking: a one-time code from the app, used once, expires, malformed codes refused", async () => {
  const { db, tg, msg, setNow } = setup();
  db.docs.set("botLinks/abcdefghijklmnop0123", { uid: "u1", exp: T0 + 600000, tz: "Asia/Almaty" });
  await msg("/start abcdefghijklmnop0123");
  assert.match(tg.last().text, /бот подключён/);
  assert.deepEqual(clone(db.docs.get("botUsers/tg_777")).uid, "u1");
  assert.equal(db.docs.has("botLinks/abcdefghijklmnop0123"), false, "the code is gone after use");
  await msg("/start abcdefghijklmnop0123");
  assert.match(tg.last().text, /устарела или уже использована/);
  db.docs.set("botLinks/zzzzzzzzzzzzzzzzzzzz", { uid: "u2", exp: T0 + 1000, tz: "Asia/Almaty" });
  setNow(T0 + 5000);
  await msg("/start zzzzzzzzzzzzzzzzzzzz");
  assert.match(tg.last().text, /устарела/);
  assert.equal(db.docs.has("botLinks/zzzzzzzzzzzzzzzzzzzz"), false, "an expired code is removed");
  await msg("/start ../../users/u1");
  assert.match(tg.last().text, /устарела/);
});

test("a phrase becomes an operation the app accepts, written as one more device", async () => {
  const { db, tg, msg, link } = setup();
  await link();
  await msg("кофе 2800");
  const ops = db.ops("u1");
  assert.equal(ops.length, 1);
  const op = ops[0];
  assert.deepEqual([op.sum, op.cat, op.note, op.pay, op.date, op._d], [-2800, "Кафе", "кофе", "card", "07.10", "tg"]);
  assert.equal(op._u, T0);
  Object.keys(op).forEach(k => assert.ok(OP_FIELDS.includes(k), k + " is allowed by firestore.rules"));
  assert.ok(Sync.clean("ops", op), "the sync engine keeps it");
  assert.match(tg.last().text, /✅ Кафе −2 800 ₸ · сегодня · карта\nкофе/);
  assert.deepEqual(tg.last().kb[0].map(b => b.data), ["u:" + op.id, "c:" + op.id]);
});

test("days are the person's: 01:30 in Almaty is already tomorrow in UTC terms", async () => {
  const { db, msg, link, setNow } = setup();
  await link();
  setNow(Date.UTC(2026, 9, 7, 20, 30));                 // 8 October, 01:30 in Almaty
  await msg("такси 1500 наличными");
  await msg("вчера кофе 900");
  const ops = db.ops("u1").sort((a, b) => b.ts - a.ts);
  assert.equal(ops[0].date, "08.10");
  assert.equal(ops[0].pay, "cash");
  assert.equal(ops[0].note, "", "a description that only names the category is not a note");
  assert.equal(ops[1].date, "07.10");
});

test("undo writes a tombstone; the message says so; undo twice is harmless", async () => {
  const { db, tg, msg, tap, link } = setup();
  await link();
  await msg("кофе 2800");
  const id = lastBtn(tg).slice(2);
  await tap("u:" + id);
  assert.deepEqual(clone(db.docs.get("users/u1/ops/" + id)), { _del: true, _u: T0, _d: "tg" });
  assert.match(tg.last().text, /Отменено: Кафе −2 800/);
  await tap("u:" + id);
  assert.match(tg.last().text, /уже нет/);
  await msg("/undo");
  assert.match(tg.last().text, /Отменять нечего/);
});

test("changing the category rewrites the operation and teaches the history", async () => {
  const { db, tg, msg, tap, link } = setup();
  await link();
  await msg("кофе 2000");
  const id = lastBtn(tg).slice(2);
  await tap("c:" + id);
  const pick = tg.last().kb.flat().find(b => b.text.includes("Развлечения"));
  await tap(pick.data);
  const changed = clone(db.docs.get("users/u1/ops/" + id));
  assert.equal(changed.cat, "Развлечения");
  assert.ok(Sync.clean("ops", changed));
  await msg("кофе 2500");
  assert.equal(db.ops("u1").find(o => o.sum === -2500).cat, "Развлечения", "the same words go there next time");
});

test("an unknown word: the bot asks with buttons, records the answer, and remembers it", async () => {
  const { db, tg, msg, tap, link } = setup();
  await link();
  await msg("Глобус 7000");
  assert.match(tg.last().text, /Куда записать −7 000 ₸ «Глобус»\?/);
  assert.equal(db.ops("u1").length, 0, "nothing written before the answer");
  const choice = tg.last().kb.flat().find(b => b.text === "Продукты");
  await tap(choice.data, 41);
  assert.equal(tg.last().m, "edit");
  assert.equal(db.ops("u1")[0].cat, "Продукты");
  await msg("Глобус 5000");
  assert.equal(db.ops("u1").length, 2, "picked from history without asking");
  await msg("Мегамаркет 100");
  await tap("x", 42);
  assert.match(tg.last().text, /Не записано/);
  assert.equal(db.ops("u1").length, 2);
});

test("income words and signs record income", async () => {
  const { db, msg, link } = setup();
  await link();
  await msg("зп 420 000");
  await msg("+3 200 кешбэк");
  const ops = db.ops("u1").sort((a, b) => b.sum - a.sum);
  assert.deepEqual(ops.map(o => [o.sum, o.cat]), [[420000, "Зарплата"], [3200, "Возврат"]]);
});

test("refusals: no amount, too big, a future day — nothing is written", async () => {
  const { db, tg, msg, link } = setup();
  await link();
  await msg("кофе");
  assert.match(tg.last().text, /Не вижу суммы/);
  await msg("звонок 87011234567");
  assert.match(tg.last().text, /999 999 999/);
  await msg("такси 1500 12.10");
  assert.match(tg.last().text, /в будущем/);
  assert.equal(db.ops("u1").length, 0);
});

test("/month and /today count the person's month and day, with the budget", async () => {
  const { tg, msg, link } = setup();
  await link({ budget: 300000 });
  await msg("кофе 2800");
  await msg("Магнум 14250");
  await msg("зп 420000");
  await msg("/month");
  const m = tg.last().text;
  assert.match(m, /Октябрь: потрачено 17 050 ₸, доход 420 000 ₸/);
  assert.match(m, /осталось 282 950 ₸/);
  assert.match(m, /Продукты 14 250 ₸, Кафе 2 800 ₸/);
  await msg("сегодня");
  assert.match(tg.last().text, /Сегодня: 3 — 17 050 ₸/);
});

test("the person's language and own categories are used", async () => {
  const { db, tg, msg, link } = setup();
  await link({ lang: "kz", eCats: ["Азық", "Собака", "Прочее"] });
  assert.match(tg.last().text, /Дайын, бот қосылды/);
  await msg("корм собаке 4000");
  assert.equal(db.ops("u1")[0].cat, "Собака");
  assert.match(tg.last().text, /бүгін/);
});

test("a daily limit stops a runaway sender", async () => {
  const { db, tg, msg, link } = setup();
  await link();
  const s = clone(db.docs.get("botUsers/tg_777"));
  db.docs.set("botUsers/tg_777", Object.assign(s, { day: "2026-10-07", count: DAILY_LIMIT }));
  await msg("кофе 500");
  assert.match(tg.last().text, /слишком много/);
  assert.equal(db.ops("u1").length, 0);
});

test("a failure is reported to the person instead of silence; group chats and odd updates are ignored", async () => {
  const { db, tg, bot, msg, link } = setup();
  await link();
  db.fail = p => p.includes("/ops/");
  await msg("кофе 500");
  assert.match(tg.last().text, /Не получилось записать/);
  const before = tg.out.length;
  await bot.handleUpdate({ message: { chat: { id: 1, type: "group" }, from: { id: 1 }, text: "кофе 500" } });
  await bot.handleUpdate({ edited_message: {} });
  await bot.handleUpdate(null);
  assert.equal(tg.out.length, before);
});

test("the same update delivered twice (the Worker was stopped half-way) makes one operation, not two", async () => {
  const { db, bot, link } = setup();
  await link();
  const update = { update_id: 5000, message: { message_id: 5000, date: Math.floor(T0 / 1000), chat: { id: 777, type: "private" }, from: { id: 777, language_code: "ru" }, text: "кофе 900" } };
  await bot.handleUpdate(update);
  await bot.handleUpdate(JSON.parse(JSON.stringify(update)));
  assert.equal(db.ops("u1").length, 1);
  assert.equal(db.ops("u1")[0].id, Math.floor(T0 / 1000) * 1000 * 1000 + 0, "id from the message time and number");
});

test("the network is loaded only when a phrase needs it", async () => {
  const db = new FakeDb(), tg = new FakeTg();
  let loads = 0;
  const bot = createBot({ tg, db, now: () => T0, model: () => { loads++; return MODEL; } });
  db.docs.set("botLinks/abcdefghijklmnop0123", { uid: "u1", exp: T0 + 600000, tz: "Asia/Almaty" });
  const send = (text, id) => bot.handleUpdate({ message: { message_id: id, date: Math.floor(T0 / 1000), chat: { id: 1, type: "private" }, from: { id: 1 }, text } });
  await send("/start abcdefghijklmnop0123", 1);
  await send("/month", 2);
  assert.equal(loads, 0);
  await send("кофе 500", 3);
  await send("чай 300", 4);
  assert.equal(loads, 1, "once per isolate");
});

test("the webhook secret is compared in full", () => {
  assert.equal(sameSecret("abc123", "abc123"), true);
  assert.equal(sameSecret("abc124", "abc123"), false);
  assert.equal(sameSecret("", ""), false);
  assert.equal(sameSecret("abc", "abc123"), false);
});
