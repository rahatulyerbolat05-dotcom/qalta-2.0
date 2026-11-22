// node --test tests/bot-v4.test.js — the Telegram bot for Qalta 4 users (botUsers.app == "v4"):
// phrases land in users/{uid}/txs in that app's format, and the evening reminder.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createBot } = require("../bot/core.js");
const CAT = require("../src/cat.js");

const MODEL = CAT.load(fs.readFileSync(path.join(__dirname, "..", "cat-model.json"), "utf8"));
const RULES = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
const fields = fn => new RegExp("function " + fn + "\\([^)]*\\) \\{\\s*return d\\.keys\\(\\)\\.hasOnly\\(\\[([^\\]]+)\\]").exec(RULES)[1].split(",").map(s => s.trim().replace(/'/g, ""));
const TX_FIELDS = fields("q4tx"), CHECKIN_FIELDS = fields("q4checkin");

const clone = x => JSON.parse(JSON.stringify(x));
class FakeDb {
  constructor() { this.docs = new Map(); }
  async get(p) { return this.docs.has(p) ? { id: p.split("/").pop(), data: clone(this.docs.get(p)) } : null; }
  async set(p, d) { this.docs.set(p, clone(d)); }
  async del(p) { this.docs.delete(p); }
  async list(coll) { return [...this.docs.entries()].filter(([k]) => k.startsWith(coll + "/") && k.split("/").length === 2).map(([k, v]) => ({ id: k.split("/")[1], data: clone(v) })); }
  async query(parent, coll, q) {
    const pre = parent + "/" + coll + "/";
    let out = [...this.docs.entries()].filter(([k]) => k.startsWith(pre) && !k.slice(pre.length).includes("/")).map(([k, v]) => ({ id: k.slice(pre.length), data: clone(v) }));
    if (q && q.where) out = out.filter(d => typeof d.data[q.where[0]] === "number" && d.data[q.where[0]] >= q.where[2]);
    if (q && q.orderBy) out = out.filter(d => d.data[q.orderBy] !== undefined).sort((a, b) => (a.data[q.orderBy] - b.data[q.orderBy]) * (q.desc ? -1 : 1));
    if (q && q.limit) out = out.slice(0, q.limit);
    return out;
  }
  under(prefix) { return [...this.docs.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v); }
}
class FakeTg {
  constructor() { this.out = []; }
  async send(chat, text, kb) { this.out.push({ m: "send", chat, text, kb }); return { message_id: this.out.length }; }
  async edit(chat, id, text, kb) { this.out.push({ m: "edit", chat, id, text, kb }); }
  async answer(id) { this.out.push({ m: "answer", id }); }
  last() { return this.out.filter(x => x.m !== "answer").slice(-1)[0]; }
  sent() { return this.out.filter(x => x.m === "send"); }
}

// 22 November 2026 (a Sunday), 13:30 in Almaty (UTC+5)
const T0 = Date.UTC(2026, 10, 22, 8, 30);
const H = 3600000;
function setup(opts) {
  opts = opts || {};
  const db = new FakeDb(), tg = new FakeTg();
  let clock = T0;
  const bot = createBot({ tg, db, model: MODEL, now: () => clock, appUrl: "https://qalta-v4.web.app" });
  const user = { id: 777, language_code: "ru" };
  let mid = 100;
  const msg = text => bot.handleUpdate({ update_id: mid, message: { message_id: mid++, date: Math.floor(clock / 1000), chat: { id: 777, type: "private" }, from: user, text } });
  const tap = (data, m) => bot.handleUpdate({ update_id: 2, callback_query: { id: "cb", from: user, data, message: { message_id: m || 9, chat: { id: 777, type: "private" } } } });
  const link = async () => {
    if (opts.accounts !== false) {
      db.docs.set("users/u1/accounts/acard", { id: "acard", name: "Карта", kind: "card", openingAmount: 100000, openingAt: 1, order: 0, updatedAt: 1 });
      db.docs.set("users/u1/accounts/acash", { id: "acash", name: "Наличные", kind: "cash", openingAmount: 5000, openingAt: 1, order: 1, updatedAt: 1 });
    }
    db.docs.set("botLinks/abcdefghijklmnop0123", { uid: "u1", exp: clock + 600000, tz: "Asia/Almaty", app: "v4" });
    await msg("/start abcdefghijklmnop0123");
  };
  return { db, tg, bot, msg, tap, link, setNow: t => { clock = t; } };
}
const txs = db => db.under("users/u1/txs/");

test("linking from Qalta 4 marks the link, and the welcome mentions the evening reminder", async () => {
  const { db, tg, link } = setup();
  await link();
  assert.equal(db.docs.get("botUsers/tg_777").app, "v4");
  assert.match(tg.last().text, /Вечером напомню/);
});

test("a phrase becomes a Qalta 4 operation the rules accept, on the account the phrase names", async () => {
  const { db, tg, msg, link } = setup();
  await link();
  await msg("такси 1500 наличными");
  const [t] = txs(db);
  assert.deepEqual([t.kind, t.amount, t.category, t.note, t.accountId, t.deviceId, t.at, t.createdAt, t.updatedAt], ["expense", 1500, "Такси", "", "acash", "tg", T0, T0, T0]);
  assert.match(t.id, /^tg\d+$/);
  Object.keys(t).forEach(k => assert.ok(TX_FIELDS.includes(k), k + " is allowed by the rules"));
  assert.equal(db.under("users/u1/ops/").length, 0, "nothing in the prototype's collection");
  assert.match(tg.last().text, /Такси −1\u00a0500\u00a0₸ · сегодня · наличные/);
  await msg("+120000 гонорар");
  const income = txs(db).find(x => x.kind === "income");
  assert.deepEqual([income.amount, income.category, income.accountId], [120000, "Гонорар", "acard"]);
});

test("undo marks the record deleted with a newer stamp; changing the category keeps its creation time", async () => {
  const { db, tg, msg, tap, link, setNow } = setup();
  await link();
  await msg("кофе 2800");
  const id = tg.last().kb[0][0].data.slice(2);
  setNow(T0 + 60000);
  await tap("s:" + id + ":" + 0); // the first category of the list, Продукты
  const changed = txs(db)[0];
  assert.notEqual(changed.category, "Кафе");
  assert.deepEqual([changed.createdAt, changed.updatedAt], [T0, T0 + 60000]);
  setNow(T0 + 120000);
  await tap("u:" + id);
  const gone = txs(db)[0];
  assert.deepEqual([gone.deleted, gone.updatedAt], [true, T0 + 120000]);
  assert.match(tg.last().text, /Отменено/);
});

test("without accounts in the app nothing is written and the person is told what to do", async () => {
  const { db, tg, msg, link } = setup({ accounts: false });
  await link();
  await msg("кофе 2800");
  assert.equal(txs(db).length, 0);
  assert.match(tg.last().text, /введите остатки/);
});

test("/today reads Qalta 4 records", async () => {
  const { tg, msg, link } = setup();
  await link();
  await msg("кофе 2800");
  await msg("обед 2500");
  await msg("/today");
  assert.match(tg.last().text, /5\u00a0300\u00a0₸/);
});

test("evening reminder: at the person's time, once a day, with a check-in button that writes a valid check-in", async () => {
  const { db, tg, bot, msg, tap, link, setNow } = setup();
  await link();
  await msg("кофе 2800");
  db.docs.set("users/u1/meta/q4", { id: "settings", until: "2026-12-05", reminder: "21:00", updatedAt: 1 });
  setNow(Date.UTC(2026, 10, 22, 15, 50)); // 20:50 local: too early
  assert.equal(await bot.remind(), 0);
  setNow(Date.UTC(2026, 10, 22, 16, 5)); // 21:05 local
  assert.equal(await bot.remind(), 1);
  const r = tg.sent().slice(-1)[0];
  assert.equal(r.chat, 777);
  assert.match(r.text, /сегодня записано 1 — расходы 2\u00a0800\u00a0₸/);
  assert.match(r.text, /За неделю потрачено 2\u00a0800\u00a0₸/, "Sunday adds the week");
  assert.deepEqual(r.kb[0][0].data, "k:20261122");
  assert.equal(r.kb[1][0].url, "https://qalta-v4.web.app");
  setNow(Date.UTC(2026, 10, 22, 16, 20));
  assert.equal(await bot.remind(), 0, "only once a day");
  await tap("k:20261122");
  const ck = db.docs.get("users/u1/checkins/2026-11-22");
  assert.deepEqual([ck.id, ck.day, ck.done, ck.deviceId], ["2026-11-22", "2026-11-22", true, "tg"]);
  Object.keys(ck).forEach(k => assert.ok(CHECKIN_FIELDS.includes(k), k + " is allowed by the rules"));
  assert.match(tg.last().text, /Сверка отмечена/);
});

test("no reminder when switched off, when the day is already checked in the app, or for prototype users", async () => {
  const off = setup();
  await off.link();
  off.db.docs.set("users/u1/meta/q4", { id: "settings", until: "2026-12-05", reminder: "", updatedAt: 1 });
  off.setNow(Date.UTC(2026, 10, 22, 16, 5));
  assert.equal(await off.bot.remind(), 0);

  const done = setup();
  await done.link();
  done.db.docs.set("users/u1/checkins/2026-11-22", { id: "2026-11-22", day: "2026-11-22", done: true, at: T0, decision: "", updatedAt: T0 });
  done.setNow(Date.UTC(2026, 10, 22, 16, 5));
  assert.equal(await done.bot.remind(), 0);

  const proto = setup();
  proto.db.docs.set("botUsers/tg_778", { uid: "u2", tz: "Asia/Almaty", linkedAt: 1, day: "", count: 0 });
  proto.setNow(Date.UTC(2026, 10, 22, 16, 5));
  assert.equal(await proto.bot.remind(), 0);
});
