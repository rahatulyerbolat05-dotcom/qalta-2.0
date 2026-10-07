// node --test tests/bot-firestore.test.js  — Firestore REST client of the bot: values, signed token, requests.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Firestore, enc, dec, encFields, decFields, signJwt } = require("../bot/firestore.js");

const subtle = globalThis.crypto.subtle;
async function serviceAccount() {
  const kp = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = Buffer.from(await subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");
  const pem = "-----BEGIN PRIVATE KEY-----\n" + der.match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n";
  return { sa: { client_email: "bot@qalta-by-yerbo.iam.gserviceaccount.com", private_key: pem }, publicKey: kp.publicKey };
}
const b64urlDecode = s => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

test("values survive the trip: integers stay integers, maps and lists nest, odd keys are dropped", () => {
  const v = { id: 1791346320000123, sum: -2800, ratio: 0.5, cat: "Кафе", ok: true, none: null, log: [{ sum: 1, date: "01.10" }], m: { a: { b: 1 } } };
  assert.deepEqual(decFields(encFields(v)), v);
  assert.deepEqual(enc(-2800), { integerValue: "-2800" });
  assert.deepEqual(enc(0.5), { doubleValue: 0.5 });
  assert.throws(() => enc(Infinity));
  assert.throws(() => enc(() => 1));
  assert.equal(Object.getPrototypeOf(decFields({ __proto__: { stringValue: "x" } })), Object.prototype);
  assert.equal(dec({ timestampValue: "2026-10-07T08:30:00Z" }), Date.UTC(2026, 9, 7, 8, 30));
});

test("the service-account token is a valid RS256 JWT for Firestore's scope", async () => {
  const { sa, publicKey } = await serviceAccount();
  const jwt = await signJwt(sa, 1791346320, subtle);
  const [h, b, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(b64urlDecode(h)), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(b64urlDecode(b));
  assert.equal(claims.iss, sa.client_email);
  assert.equal(claims.scope, "https://www.googleapis.com/auth/datastore");
  assert.equal(claims.exp - claims.iat, 3600);
  assert.ok(await subtle.verify("RSASSA-PKCS1-v1_5", publicKey, b64urlDecode(s), new TextEncoder().encode(h + "." + b)), "the signature verifies");
});

test("requests: one token for many calls, documents read and written whole, 404 is 'no document', queries shaped right", async () => {
  const { sa } = await serviceAccount();
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return json(200, { access_token: "T1", expires_in: 3600 });
    if (init.method === "GET" && url.endsWith("/botUsers/tg_1")) return json(404, { error: { status: "NOT_FOUND" } });
    if (init.method === "GET") return json(200, { name: "projects/p/databases/(default)/documents/users/u1/meta/settings", fields: { lang: { stringValue: "kz" } } });
    if (url.endsWith(":runQuery")) return json(200, [{ document: { name: ".../ops/17", fields: { sum: { integerValue: "-5" } } } }, { readTime: "x" }]);
    return json(200, {});
  };
  let now = 1791346320000;
  const db = new Firestore({ projectId: "qalta-by-yerbo", serviceAccount: sa, fetch, now: () => now, subtle });
  assert.equal(await db.get("botUsers/tg_1"), null);
  assert.deepEqual(await db.get("users/u1/meta/settings"), { id: "settings", data: { lang: "kz" } });
  await db.set("users/u1/ops/17", { sum: -5, _u: 1, _d: "tg" });
  const rows = await db.query("users/u1", "ops", { where: ["ts", ">=", 100], orderBy: "ts", desc: true, limit: 3 });
  assert.deepEqual(rows, [{ id: "17", data: { sum: -5 } }]);
  assert.equal(calls.filter(c => c.url.includes("oauth2")).length, 1, "the token is reused");
  const put = calls.find(c => c.init.method === "PATCH");
  assert.ok(put.url.endsWith("/documents/users/u1/ops/17"));
  assert.deepEqual(JSON.parse(put.init.body), { fields: { sum: { integerValue: "-5" }, _u: { integerValue: "1" }, _d: { stringValue: "tg" } } });
  assert.equal(put.init.headers.Authorization, "Bearer T1");
  const q = JSON.parse(calls.find(c => c.url.endsWith(":runQuery")).init.body).structuredQuery;
  assert.deepEqual(q.where.fieldFilter.op, "GREATER_THAN_OR_EQUAL");
  assert.deepEqual(q.orderBy, [{ field: { fieldPath: "ts" }, direction: "DESCENDING" }]);
  now += 3600 * 1000;                                  // an hour later the token is renewed
  await db.get("users/u1/meta/settings");
  assert.equal(calls.filter(c => c.url.includes("oauth2")).length, 2);
});

test("a refused request is an error, not an empty answer", async () => {
  const { sa } = await serviceAccount();
  const fetch = async url => url.includes("oauth2") ? { ok: true, status: 200, json: async () => ({ access_token: "T", expires_in: 3600 }) } : { ok: false, status: 403, json: async () => ({ error: { status: "PERMISSION_DENIED" } }) };
  const db = new Firestore({ projectId: "p", serviceAccount: sa, fetch, subtle });
  await assert.rejects(db.set("users/u1/ops/1", { a: 1 }), /403: PERMISSION_DENIED/);
  await assert.rejects(db.query("users/u1", "ops"), /403/);
  assert.throws(() => new Firestore({ projectId: "p", serviceAccount: {}, fetch }), /service account/);
});
