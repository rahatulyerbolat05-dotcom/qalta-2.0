// Firestore over its REST API with a service account — for a server with no Firebase SDK (a Cloudflare Worker).
// Works on the free Spark plan: no Cloud Functions involved. A service account bypasses the security rules, so
// everything written here must already be valid (bot/core.js passes operations through sync-engine's clean()).
// No Node APIs: fetch and WebCrypto only, so the same file runs in a Worker and in Node 20+ tests.
"use strict";

const SCOPE = "https://www.googleapis.com/auth/datastore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// ── values: plain JS <-> Firestore's typed JSON ──
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    if (!isFinite(v)) throw new Error("not a finite number");
    return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === "object") return { mapValue: { fields: encFields(v) } };
  throw new Error("cannot store a " + typeof v);
}
function encFields(o) {
  const f = {};
  Object.keys(o).forEach(k => { if (o[k] !== undefined) f[k] = enc(o[k]); });
  return f;
}
function dec(x) {
  if (!x || typeof x !== "object") return null;
  if ("stringValue" in x) return x.stringValue;
  if ("integerValue" in x) return Number(x.integerValue);
  if ("doubleValue" in x) return Number(x.doubleValue);
  if ("booleanValue" in x) return !!x.booleanValue;
  if ("timestampValue" in x) return Date.parse(x.timestampValue);
  if ("mapValue" in x) return decFields((x.mapValue && x.mapValue.fields) || {});
  if ("arrayValue" in x) return ((x.arrayValue && x.arrayValue.values) || []).map(dec);
  return null;
}
function decFields(f) {
  const o = {};
  Object.keys(f || {}).forEach(k => { if (k !== "__proto__") o[k] = dec(f[k]); });
  return o;
}

// ── service-account token (RS256 JWT, cached until a minute before it expires) ──
function b64url(bytes) {
  let s = ""; const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToDer(pem) {
  const b = atob(String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u.buffer;
}
async function signJwt(sa, nowSec, subtle) {
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 })));
  const key = await subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + body));
  return head + "." + body + "." + b64url(sig);
}

class Firestore {
  // o: { projectId, serviceAccount (parsed JSON key), fetch, now (ms), subtle (WebCrypto) }
  constructor(o) {
    if (!o || !o.projectId || !o.serviceAccount || !o.serviceAccount.client_email || !o.serviceAccount.private_key) throw new Error("Firestore needs a project id and a service account key");
    this.base = "https://firestore.googleapis.com/v1/projects/" + o.projectId + "/databases/(default)/documents";
    this.sa = o.serviceAccount; this.fetch = o.fetch; this.now = o.now || Date.now;
    this.subtle = o.subtle || (globalThis.crypto && globalThis.crypto.subtle);
    this.tok = null;
  }
  async token() {
    const now = this.now();
    if (this.tok && this.tok.exp - 60000 > now) return this.tok.v;
    const jwt = await signJwt(this.sa, Math.floor(now / 1000), this.subtle);
    const r = await this.fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + encodeURIComponent(jwt) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error("service account token refused (" + r.status + ")");
    this.tok = { v: j.access_token, exp: now + (j.expires_in || 3600) * 1000 };
    return this.tok.v;
  }
  async call(method, url, body) {
    const r = await this.fetch(url, { method, headers: { Authorization: "Bearer " + (await this.token()), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 404 && method === "GET") return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("Firestore " + method + " " + r.status + ": " + ((j.error && j.error.status) || ""));
    return j;
  }
  static path(p) { return String(p).split("/").map(encodeURIComponent).join("/"); }
  // -> { id, data } | null
  async get(path) {
    const j = await this.call("GET", this.base + "/" + Firestore.path(path));
    return j ? { id: j.name.split("/").pop(), data: decFields(j.fields) } : null;
  }
  // whole document replaced (the sync engine writes documents whole, too)
  async set(path, data) { await this.call("PATCH", this.base + "/" + Firestore.path(path), { fields: encFields(data) }); }
  async del(path) { await this.call("DELETE", this.base + "/" + Firestore.path(path)); }
  // documents of parent/collection; q: { where: [field, ">=", value], orderBy: field, desc: bool, limit }
  async query(parent, collection, q) {
    q = q || {};
    const sq = { from: [{ collectionId: collection }] };
    if (q.where) sq.where = { fieldFilter: { field: { fieldPath: q.where[0] }, op: { ">=": "GREATER_THAN_OR_EQUAL", "<": "LESS_THAN", "==": "EQUAL", ">": "GREATER_THAN" }[q.where[1]], value: enc(q.where[2]) } };
    if (q.orderBy) sq.orderBy = [{ field: { fieldPath: q.orderBy }, direction: q.desc ? "DESCENDING" : "ASCENDING" }];
    if (q.limit) sq.limit = q.limit;
    const j = await this.call("POST", this.base + "/" + Firestore.path(parent) + ":runQuery", { structuredQuery: sq });
    return (Array.isArray(j) ? j : []).filter(x => x.document).map(x => ({ id: x.document.name.split("/").pop(), data: decFields(x.document.fields) }));
  }
}

module.exports = { Firestore, enc, dec, encFields, decFields, signJwt, b64url };
