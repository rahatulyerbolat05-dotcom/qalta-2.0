// node --test tests/tg-link.test.js  — "Telegram bot → Connect" in Settings, on the real component.
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers/harness.js");

function app(opts) {
  const h = load();
  const writes = [];
  h.window.QALTA_TELEGRAM_BOT = opts.bot;
  h.c._fbAuth = { currentUser: opts.user || null };
  h.c._fbDb = { collection: name => ({ doc: id => ({ set: data => { writes.push({ name, id, data }); return opts.fail ? Promise.reject(new Error("PERMISSION_DENIED")) : Promise.resolve(); } }) }) };
  if (opts.user) h.c.setState({ fbUser: { uid: opts.user.uid, name: "A" } });
  return Object.assign(h, { writes, vals: () => h.c.renderVals() });
}
const settle = () => new Promise(r => setTimeout(r, 10));

test("the row shows only with a bot name and a signed-in account", () => {
  assert.equal(app({ bot: "" , user: { uid: "u1" } }).vals().tgEnabled, false, "no bot configured");
  assert.equal(app({ bot: "qalta_test_bot" }).vals().tgEnabled, false, "not signed in");
  assert.equal(app({ bot: "bad name!", user: { uid: "u1" } }).vals().tgEnabled, false, "not a bot username");
  assert.equal(app({ bot: "qalta_test_bot", user: { uid: "u1" } }).vals().tgEnabled, true);
});

test("Connect writes a one-time code for this account and opens the bot with it", async () => {
  const h = app({ bot: "qalta_test_bot", user: { uid: "u1" } });
  const before = Date.now();
  h.vals().tgConnect();
  await settle();
  assert.equal(h.writes.length, 1);
  const w = h.writes[0];
  assert.equal(w.name, "botLinks");
  assert.match(w.id, /^[A-Za-z0-9_-]{20}$/, "120 random bits, URL-safe");
  assert.deepEqual(Object.keys(w.data).sort(), ["exp", "tz", "uid"], "exactly the fields firestore.rules allow");
  assert.equal(w.data.uid, "u1");
  assert.ok(w.data.exp > before && w.data.exp <= Date.now() + 15 * 60000, "valid for 15 minutes");
  assert.equal(typeof w.data.tz, "string");
  assert.equal(h.c.state.toast.text, h.I18N.ru.tgOpened);
  const h2 = app({ bot: "qalta_test_bot", user: { uid: "u1" } });
  h2.vals().tgConnect();
  await settle();
  assert.notEqual(h2.writes[0].id, w.id, "a new code every time");
});

test("a refused write is told, not hidden", async () => {
  const h = app({ bot: "qalta_test_bot", user: { uid: "u1" }, fail: true });
  h.vals().tgConnect();
  await settle();
  assert.equal(h.c.state.toast.text, h.I18N.ru.tgFailed);
});
