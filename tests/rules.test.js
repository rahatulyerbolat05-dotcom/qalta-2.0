"use strict";
// firestore.rules is not run in an emulator here, so this pins the contract between the rules and
// the client: whatever the sync engine can write must be allowed by hasOnly, and every guard must
// name a field that the list allows. A field added to the engine but forgotten in the rules makes
// every sync write fail after the next deploy, so it is checked here.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const Sync = require("../sync-engine.js");

const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");

function body(name) {
  const i = rules.indexOf("function " + name + "(");
  assert.ok(i >= 0, "function " + name + " exists in the rules");
  const rest = rules.slice(i + 10);
  const j = rest.search(/\n\s*(function |match )/);
  return rules.slice(i, j < 0 ? undefined : i + 10 + j);
}
function allowedKeys(name) {
  const m = body(name).match(/hasOnly\(\[([^\]]*)\]\)/);
  assert.ok(m, name + " has a hasOnly list");
  return m[1].split(",").map(s => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
}
const visible = keys => keys.filter(k => k[0] !== "_").sort();

test("rules allow exactly the operation fields the engine writes", () => {
  const full = { id: 1, date: "01.01", cat: "A", note: "n", sum: 1, pay: "cash", ts: 5 };
  assert.deepEqual(visible(allowedKeys("validOp")), Object.keys(Sync.clean("ops", full)).sort());
});

test("rules allow exactly the debt fields the engine writes", () => {
  const full = { id: 1, who: "A", note: "n", sum: 5, mine: true, paid: 1, log: [], closed: true, closedAt: "01.01", reason: "r", due: "2026-01-01", ts: 5 };
  assert.deepEqual(visible(allowedKeys("validDebt")), Object.keys(Sync.clean("debts", full)).sort());
});

test("rules allow exactly the settings fields the engine writes", () => {
  const sample = {
    hex: "#112233", skin: 1, set: 1, lang: "ru", eCats: ["a"], iCats: ["a"], catColors: { a: "#112233" }, catSizes: { a: "full" }, catIcons: { a: "tag" },
    budget: 5, openCash: 5, openCard: 5, openCashAt: 5, openCardAt: 5
  };
  assert.deepEqual(Object.keys(sample).sort(), Sync.SETTINGS_KEYS.slice().sort(), "the sample covers every synced setting");
  assert.deepEqual(Object.keys(Sync.clean("meta", sample)).sort(), Sync.SETTINGS_KEYS.slice().sort());
  assert.deepEqual(visible(allowedKeys("validSettings")), Sync.SETTINGS_KEYS.slice().sort());
});

test("a field patch for a debt only touches fields the rules allow", () => {
  const FV = { increment: n => n, arrayUnion: (...v) => v, delete: () => null };
  const base = { id: 1, who: "A", note: "", sum: 100, mine: true, paid: 0, log: [], closed: false };
  const cur = { id: 1, who: "B", note: "x", sum: 200, mine: false, paid: 5, log: [{ sum: 5, date: "01.01" }], closed: true, closedAt: "01.01", reason: "r", due: "2026-01-01", ts: 9 };
  const patch = Sync.debtPatch(base, cur, FV);
  const allowed = allowedKeys("validDebt");
  Object.keys(patch).forEach(k => assert.ok(allowed.indexOf(k) >= 0, "patch field " + k + " is allowed"));
});

test("every optional-field guard in the rules names a field its hasOnly list allows", () => {
  ["validOp", "validDebt", "validSettings"].forEach(name => {
    const allowed = allowedKeys(name), guards = [];
    body(name).replace(/!\('([A-Za-z]+)' in d\)/g, (all, k) => { guards.push(k); return all; });
    guards.forEach(k => assert.ok(allowed.indexOf(k) >= 0, name + ": guard for '" + k + "' is not in hasOnly"));
  });
});

test("amount and time bounds agree between the rules and the client", () => {
  assert.match(rules, /n >= -999999999 && n <= 999999999/);
  const ok = Sync.clean("ops", { id: 1, date: "01.01", cat: "A", note: "", sum: 999999999, pay: "card" });
  const tooBig = Sync.clean("ops", { id: 1, date: "01.01", cat: "A", note: "", sum: 1000000000, pay: "card" });
  assert.ok(ok && !tooBig);
  assert.match(rules, /_u <= 4102444800000/);
  assert.match(rules, /n < 8640000000000000/);
});

test("nothing outside the three per-user collections and the bot link codes is reachable", () => {
  const matches = (rules.match(/^\s*match [^\n]*\{\s*$/gm) || []).map(s => s.trim());
  assert.deepEqual(matches, [
    "match /databases/{database}/documents {",
    "match /users/{uid} {",
    "match /ops/{id} {",
    "match /debts/{id} {",
    "match /meta/{docId} {",
    "match /botLinks/{code} {"
  ]);
  assert.ok(!/allow [^;]*:\s*if\s+true/.test(rules), "no unconditional allow");
});

test("bot link codes can only be created, for one's own uid, short-lived, with the fields the bot reads", () => {
  const block = /match \/botLinks\/\{code\} \{([\s\S]*?)\n    \}/.exec(rules)[1];
  assert.deepEqual((block.match(/allow ([a-z, ]+):/g) || []).map(s => s.trim()), ["allow create:"], "no read, update, delete or list");
  assert.match(block, /request\.resource\.data\.uid == request\.auth\.uid/);
  assert.match(block, /hasOnly\(\['uid', 'exp', 'tz'\]\)/);
  assert.match(block, /exp <= request\.time\.toMillis\(\) \+ 1800000/);
  const core = fs.readFileSync(path.join(__dirname, "..", "bot", "core.js"), "utf8");
  ["uid", "exp", "tz"].forEach(f => assert.ok(core.includes("doc.data." + f) || core.includes("data." + f), "the bot reads " + f));
});
