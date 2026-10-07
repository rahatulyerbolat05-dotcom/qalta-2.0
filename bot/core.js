// Қalta Telegram bot: one line in, one operation in the person's Firestore data out.
// Host-agnostic: it gets an update and two clients (Telegram, Firestore) and returns when done, so it runs in a
// Cloudflare Worker (bot/worker.js) and in Node tests with fakes (tests/bot.test.js).
//
// Data (the bot is one more "device" of the sync engine, _d: "tg"):
//   users/{uid}/ops/{id}      operations, written whole with _u/_d exactly as the app writes them; undo = tombstone
//   users/{uid}/meta/settings read only: language, categories, budget
//   botLinks/{code}           one-time link codes created by the signed-in app ({ uid, exp, tz }); read and deleted here
//   botUsers/tg_{telegramId}  the link and the bot's own state (time zone, daily counter, last operation,
//                             the pending question, a cache of the person's history). Outside users/{uid}: the sync
//                             engine would treat an unknown document there as deleted locally and erase it.
"use strict";
const QL = require("../src/logic.js");
const QP = require("../src/parse.js");
const CAT = require("../src/cat.js");
const I18N = require("../src/i18n.js");
const Sync = require("../sync-engine.js");
const S = require("./strings.js");

const DEVICE = "tg";
const DAILY_LIMIT = 300;                    // operations through the bot per person per day
const MEMO_TTL = 12 * 3600 * 1000;          // the history cache is rebuilt twice a day
const DEFAULT_TZ = "Asia/Almaty";

// ── time: the person's wall clock, read through this runtime's local-time functions ──
// logic.js and parse.js work in local time; a Worker runs in UTC. Shifting "now" by the difference makes their
// "today", "вчера" and "12.10" the person's; stored timestamps stay real (shift subtracted back).
function tzOffsetMin(tz, ts) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ts));
    const g = k => +parts.find(p => p.type === k).value;
    return Math.round((Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(ts / 1000) * 1000) / 60000);
  } catch (e) { return 300; }
}
function shiftFor(tz, ts) { return (tzOffsetMin(tz, ts) + new Date(ts).getTimezoneOffset()) * 60000; }
function validTz(tz) {
  if (typeof tz !== "string" || tz.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return DEFAULT_TZ;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch (e) { return DEFAULT_TZ; }
}

// constant-time comparison of the webhook secret
function sameSecret(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function langOf(settingsLang, from) {
  if (settingsLang === "ru" || settingsLang === "kz" || settingsLang === "en") return settingsLang;
  const c = String((from && from.language_code) || "").toLowerCase();
  return c.indexOf("kk") === 0 ? "kz" : c.indexOf("en") === 0 ? "en" : "ru";
}
function trCat(name, lang) { const r = I18N.CAT_TR[name]; return (lang !== "ru" && r && r[lang]) || name; }
function aliases(name) { const r = I18N.CAT_TR[name]; return r ? Object.keys(r).map(k => r[k]).filter(v => v && v !== name) : []; }
function money(n, lang, signed) { return (signed ? QL.fmtSigned(n, lang) : QL.fmtInt(n, lang)) + QL.NBSP + "₸"; }
function rows(buttons, per) { const out = []; for (let i = 0; i < buttons.length; i += per) out.push(buttons.slice(i, i + per)); return out; }
// a cached history comes back as plain objects: give them no prototype again ("constructor" is a category name)
function bare(json) {
  return JSON.parse(json, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.assign(Object.create(null), v) : v));
}
// the description becomes the note unless it only names the category ("такси 1500")
function noteFor(rest, cat) {
  const w = CAT.words(rest);
  if (w.length === 1 && (CAT.namesCategory(w, cat) || aliases(cat).some(a => CAT.namesCategory(w, a)))) return "";
  return String(rest || "").slice(0, 200);
}
// add (delta 1) or take back (delta -1) one filing in the history cache (same shape as CAT.memory)
function bump(mem, op, delta) {
  const one = CAT.memory([op]), d = delta || 1;
  ["notes", "toks"].forEach(part => Object.keys(one[part]).forEach(key => {
    const into = mem[part][key] || (mem[part][key] = Object.create(null));
    Object.keys(one[part][key]).forEach(c => {
      into[c] = (into[c] || 0) + d * one[part][key][c];
      if (into[c] <= 0) delete into[c];
    });
    if (!Object.keys(into).length) delete mem[part][key];
  }));
  return mem;
}

// The id of the operation a message makes is derived from the message (its time and number), not from the
// clock: if Telegram delivers the same update again (the Worker was stopped half-way), the write lands on the
// same document instead of making a second one. Same shape as QL.newId: milliseconds * 1000 + 0..999.
function idFor(m, fallbackTs) {
  return m && m.date > 0 && m.message_id >= 0 ? m.date * 1000 * 1000 + (m.message_id % 1000) : QL.newId(fallbackTs);
}

function createBot(o) {
  const tg = o.tg, db = o.db, now = o.now || Date.now, log = o.log || (() => {});
  // the network is loaded on first use (o.model may be a function): linking and reports never pay for it
  let modelCache = typeof o.model === "function" ? undefined : o.model || null;
  const model = () => { if (modelCache === undefined) { try { modelCache = o.model() || null; } catch (e) { log("model: " + e.message); modelCache = null; } } return modelCache; };
  const userKey = from => "botUsers/tg_" + Number(from.id);

  async function context(link, from) {
    const uid = link.data.uid, tz = validTz(link.data.tz), t0 = now(), shift = shiftFor(tz, t0);
    const st = await db.get("users/" + uid + "/meta/settings");
    const s = (st && Sync.clean("meta", st.data)) || {};
    const lang = langOf(s.lang, from);
    const cats = { expense: s.eCats && s.eCats.length ? s.eCats : QL.DEFAULT_CATS.expense, income: s.iCats && s.iCats.length ? s.iCats : QL.DEFAULT_CATS.income };
    return { uid, tz, lang, t: S[lang], cats, s, shift, now: t0, nowS: t0 + shift, link: link.data, key: userKey(from) };
  }
  // the bot's state document, rewritten whole; undefined fields are dropped
  async function saveState(ctx, patch) {
    const next = Object.assign({}, ctx.link, patch);
    Object.keys(next).forEach(k => { if (next[k] === undefined) delete next[k]; });
    ctx.link = next;
    await db.set(ctx.key, next);
  }
  async function memory(ctx) {
    if (ctx.mem) return ctx.mem;
    const d = ctx.link;
    if (d.memo && d.memoAt > ctx.now - MEMO_TTL) { try { return (ctx.mem = bare(d.memo)); } catch (e) {} }
    const recent = await db.query("users/" + ctx.uid, "ops", { orderBy: "ts", desc: true, limit: 300 });
    ctx.mem = CAT.memory(recent.map(x => x.data).filter(x => x && !x._del));
    ctx.memoAt = ctx.now;
    return ctx.mem;
  }
  function memoPatch(ctx) { return ctx.mem ? { memo: JSON.stringify(ctx.mem), memoAt: ctx.memoAt || ctx.link.memoAt || ctx.now } : {}; }

  function dayWord(ctx, ts) {
    const d = QL.dayDiff(ctx.nowS, ts + ctx.shift);
    return d === 0 ? ctx.t.today_w : d === 1 ? ctx.t.yesterday_w : QL.ddmm(ts + ctx.shift);
  }
  function savedText(ctx, op) {
    const line = QL.fill(ctx.t.saved, { cat: trCat(op.cat, ctx.lang), amount: money(op.sum, ctx.lang, true), when: dayWord(ctx, op.ts), pay: op.pay === "cash" ? ctx.t.cash : ctx.t.card });
    return op.note ? line + "\n" + op.note : line;
  }
  const savedKb = (ctx, id) => [[{ text: ctx.t.undoBtn, data: "u:" + id }, { text: ctx.t.catBtn, data: "c:" + id }]];

  // ── writing ──
  async function writeOp(ctx, op) {
    const c = Sync.clean("ops", op);
    if (!c || c.cat !== op.cat || c.sum !== op.sum) throw new Error("operation would not pass the app's validation");
    await db.set("users/" + ctx.uid + "/ops/" + c.id, Object.assign({}, c, { _u: ctx.now, _d: DEVICE }));
    return c;
  }
  async function save(ctx, chat, draft, cat, editId) {
    const day = QL.ymd(ctx.nowS), count = ctx.link.day === day ? ctx.link.count || 0 : 0;
    const op = await writeOp(ctx, { id: draft.id || QL.newId(ctx.now), date: QL.ddmm(draft.ts + ctx.shift), ts: draft.ts, cat, note: noteFor(draft.rest, cat), sum: (draft.dir === "income" ? 1 : -1) * draft.amount, pay: draft.pay });
    await memory(ctx);
    bump(ctx.mem, op);
    await saveState(ctx, Object.assign({ day, count: count + 1, last: String(op.id), pending: undefined }, memoPatch(ctx)));
    return editId ? tg.edit(chat, editId, savedText(ctx, op), savedKb(ctx, op.id)) : tg.send(chat, savedText(ctx, op), savedKb(ctx, op.id));
  }

  async function record(ctx, chat, text, id) {
    const t = ctx.t, day = QL.ymd(ctx.nowS);
    if (ctx.link.day === day && (ctx.link.count || 0) >= DAILY_LIMIT) return tg.send(chat, t.limit);
    const p = QP.parsePhrase(text, ctx.nowS);
    if (p.tooBig) return tg.send(chat, t.tooBig);
    if (!(p.amount > 0)) return tg.send(chat, t.noAmount);
    const when = QP.phraseTs(p, ctx.nowS);
    if (when.future) return tg.send(chat, t.future);
    const mem = await memory(ctx);
    const g = CAT.suggest({ text: p.rest, dir: p.dir || "expense", cats: ctx.cats, model: model(), mem, alias: aliases });
    const dir = p.dir || (g.cat ? g.dir : "expense");
    const draft = { id, amount: p.amount, dir, ts: when.ts == null ? ctx.now : when.ts - ctx.shift, pay: p.pay || "card", rest: p.rest };
    if (g.cat && g.dir === dir) return save(ctx, chat, draft, g.cat, null);
    // not sure: ask, with the likeliest categories first
    const list = ctx.cats[dir], seen = Object.create(null);
    const choices = (g.dir === dir ? g.ranked : []).concat(list).filter(c => list.indexOf(c) >= 0 && !seen[c] && (seen[c] = 1)).slice(0, 6);
    await saveState(ctx, Object.assign({ pending: JSON.stringify(Object.assign({}, draft, { cats: choices })) }, memoPatch(ctx)));
    const buttons = rows(choices.map((c, i) => ({ text: trCat(c, ctx.lang), data: "p:" + i })), 2).concat([[{ text: t.cancelBtn, data: "x" }]]);
    return tg.send(chat, QL.fill(t.ask, { amount: money((dir === "income" ? 1 : -1) * p.amount, ctx.lang, true), what: p.rest ? " «" + p.rest + "»" : "" }), buttons);
  }

  async function undo(ctx, chat, id, editId) {
    const path = "users/" + ctx.uid + "/ops/" + id, doc = await db.get(path);
    if (!doc || doc.data._del) return editId ? tg.edit(chat, editId, ctx.t.gone) : tg.send(chat, ctx.t.nothingToUndo);
    await db.set(path, { _del: true, _u: ctx.now, _d: DEVICE });
    const gone = Sync.clean("ops", doc.data);
    await memory(ctx);
    if (gone) bump(ctx.mem, gone, -1);    // an undone entry teaches nothing
    await saveState(ctx, Object.assign(ctx.link.last === String(id) ? { last: undefined } : {}, memoPatch(ctx)));
    const text = QL.fill(ctx.t.undone, { cat: trCat(doc.data.cat, ctx.lang), amount: money(doc.data.sum, ctx.lang, true) });
    return editId ? tg.edit(chat, editId, text) : tg.send(chat, text);
  }
  async function showCats(ctx, chat, id, editId) {
    const doc = await db.get("users/" + ctx.uid + "/ops/" + id);
    if (!doc || doc.data._del) return tg.edit(chat, editId, ctx.t.gone);
    const list = ctx.cats[doc.data.sum > 0 ? "income" : "expense"].slice(0, 40);
    const buttons = rows(list.map((c, i) => ({ text: (c === doc.data.cat ? "• " : "") + trCat(c, ctx.lang), data: "s:" + id + ":" + i })), 3);
    return tg.edit(chat, editId, QL.fill(ctx.t.pickCat, { amount: money(doc.data.sum, ctx.lang, true) }), buttons);
  }
  async function setCat(ctx, chat, id, i, editId) {
    const path = "users/" + ctx.uid + "/ops/" + id, doc = await db.get(path);
    if (!doc || doc.data._del) return tg.edit(chat, editId, ctx.t.gone);
    const cat = ctx.cats[doc.data.sum > 0 ? "income" : "expense"][i];
    if (!cat) return null;
    const before = Sync.clean("ops", doc.data);
    const op = await writeOp(ctx, Object.assign({}, before, { cat }));
    await memory(ctx);
    bump(ctx.mem, before, -1);            // the filing moves: next time the same words go here
    bump(ctx.mem, op);
    await saveState(ctx, memoPatch(ctx));
    return tg.edit(chat, editId, savedText(ctx, op), savedKb(ctx, op.id));
  }

  async function month(ctx, chat) {
    const t = ctx.t, lang = ctx.lang, range = QL.periodRange("month", ctx.nowS);
    const docs = await db.query("users/" + ctx.uid, "ops", { where: ["ts", ">=", range.from - ctx.shift] });
    const ops = docs.map(d => d.data).filter(o => o && !o._del && typeof o.sum === "number").map(o => Object.assign({}, o, { ts: o.ts + ctx.shift }));
    const tot = QL.totals(ops);
    const lines = [QL.fill(t.month, { month: QL.capitalize(QL.fmtDate(ctx.nowS, lang, { month: "long" })), spent: money(tot.spent, lang), income: money(tot.income, lang) })];
    const b = QL.budgetStatus(ctx.s.budget, tot.spent, ctx.nowS);
    if (b.has) lines.push(b.over ? QL.fill(t.monthOver, { budget: money(b.budget, lang), over: money(-b.left, lang) })
      : QL.fill(t.monthBudget, { budget: money(b.budget, lang), left: money(b.left, lang), perDay: money(b.perDay, lang), days: b.daysLeft }));
    const top = QL.byCategory(ops).slice(0, 3);
    if (top.length) lines.push(QL.fill(t.top, { list: top.map(x => trCat(x.cat, lang) + " " + money(x.sum, lang)).join(", ") }));
    return tg.send(chat, lines.join("\n"));
  }
  async function today(ctx, chat) {
    const t = ctx.t, lang = ctx.lang, from = QL.startOfDay(ctx.nowS) - ctx.shift;
    const docs = await db.query("users/" + ctx.uid, "ops", { where: ["ts", ">=", from] });
    const ops = docs.map(d => d.data).filter(o => o && !o._del && typeof o.sum === "number").sort((a, b) => a.ts - b.ts);
    if (!ops.length) return tg.send(chat, t.todayNone);
    const lines = ops.map(o => QL.hhmm(o.ts + ctx.shift) + " · " + trCat(o.cat, lang) + " · " + money(o.sum, lang, true) + (o.note ? " · " + o.note : ""));
    lines.push(QL.fill(t.today, { n: ops.length, spent: money(QL.totals(ops).spent, lang) }));
    return tg.send(chat, lines.join("\n"));
  }

  async function start(chat, from, code) {
    const t0 = S[langOf(null, from)];
    if (!code) { const link = await db.get(userKey(from)); return tg.send(chat, link ? t0.help : t0.hello); }
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return tg.send(chat, t0.badLink);
    const doc = await db.get("botLinks/" + code);
    if (!doc || typeof doc.data.uid !== "string" || !doc.data.uid || !(doc.data.exp > now())) {
      if (doc) await db.del("botLinks/" + code);
      return tg.send(chat, t0.badLink);
    }
    await db.del("botLinks/" + code);           // one use only, whatever happens next
    await db.set(userKey(from), { uid: doc.data.uid, tz: validTz(doc.data.tz), linkedAt: now(), day: "", count: 0 });
    const ctx = await context(await db.get(userKey(from)), from);
    return tg.send(chat, ctx.t.linked);
  }

  async function onMessage(m) {
    if (!m.chat || m.chat.type !== "private" || typeof m.text !== "string" || !m.from) return null;
    const chat = m.chat.id, text = m.text.trim().slice(0, 500);
    const cmd = /^\/([a-z]+)(?:@\w+)?(?:\s+(.*))?$/i.exec(text);
    if (cmd && cmd[1].toLowerCase() === "start") return start(chat, m.from, (cmd[2] || "").trim());
    const link = await db.get(userKey(m.from));
    if (!link) return tg.send(chat, S[langOf(null, m.from)].hello);
    const ctx = await context(link, m.from);
    const word = (cmd ? cmd[1] : text).toLowerCase();
    if (cmd && word === "stop") { await db.del(ctx.key); return tg.send(chat, ctx.t.stopped); }
    if (cmd && word === "help") return tg.send(chat, ctx.t.help);
    if (/^(month|balance|баланс|остаток|месяц|ай)$/.test(word)) return month(ctx, chat);
    if (/^(today|сегодня|бүгін)$/.test(word)) return today(ctx, chat);
    if (cmd && word === "undo") return ctx.link.last ? undo(ctx, chat, ctx.link.last, null) : tg.send(chat, ctx.t.nothingToUndo);
    if (cmd) return tg.send(chat, ctx.t.help);
    return record(ctx, chat, text, idFor(m, ctx.now));
  }

  async function onCallback(q) {
    const msg = q.message, data = String(q.data || "");
    const link = q.from ? await db.get(userKey(q.from)) : null;
    if (!link || !msg || !msg.chat) { await tg.answer(q.id); return null; }
    const ctx = await context(link, q.from), chat = msg.chat.id, mid = msg.message_id;
    let m;
    if ((m = /^u:(\d{1,17})$/.exec(data))) await undo(ctx, chat, m[1], mid);
    else if ((m = /^c:(\d{1,17})$/.exec(data))) await showCats(ctx, chat, m[1], mid);
    else if ((m = /^s:(\d{1,17}):(\d{1,2})$/.exec(data))) await setCat(ctx, chat, m[1], +m[2], mid);
    else if ((m = /^p:(\d)$/.exec(data)) || data === "x") {
      let pend = null; try { pend = ctx.link.pending ? JSON.parse(ctx.link.pending) : null; } catch (e) {}
      const cat = pend && m && pend.cats[+m[1]];
      if (!pend || (m && !cat)) await tg.edit(chat, mid, ctx.t.gone);
      else if (data === "x") { await saveState(ctx, { pending: undefined }); await tg.edit(chat, mid, ctx.t.notSaved); }
      else await save(ctx, chat, pend, cat, mid);
    }
    await tg.answer(q.id);
    return null;
  }

  async function handleUpdate(u) {
    try {
      if (u && u.message) return await onMessage(u.message);
      if (u && u.callback_query) return await onCallback(u.callback_query);
      return null;
    } catch (e) {
      log("update failed: " + (e && e.message));
      const m = u && (u.message || (u.callback_query && u.callback_query.message));
      const from = u && ((u.message && u.message.from) || (u.callback_query && u.callback_query.from));
      if (m && m.chat) { try { await tg.send(m.chat.id, S[langOf(null, from)].failed); } catch (x) { /* nothing more to do */ } }
      return null;
    }
  }

  return { handleUpdate };
}

module.exports = { createBot, sameSecret, shiftFor, validTz, noteFor, idFor, DEVICE, DAILY_LIMIT };
