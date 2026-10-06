"use strict";
// The offline shell (sw.js), the hosting config and the build: what ships must be what the sources say,
// and the worker must behave when the network does not.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");
const build = require("../tools/build.js");

const ROOT = path.join(__dirname, "..");
const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");

// ---------- the shipped files are current ----------
test("index.html contains exactly what the sources build to", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const m = /<script type="__bundler\/template">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, "bundle has a template block");
  const shipped = JSON.parse(m[1]);
  assert.equal(shipped, build.buildTemplate(), "run `npm run build` after changing anything in src/");
});

test("the offline cache is named after the shipped files (rebuilt after every change)", () => {
  const m = /const VERSION = "([^"]+)"/.exec(swSource);
  assert.ok(m);
  assert.equal(m[1], "qalta-shell-" + build.shellHash(), "run `npm run build` to restamp sw.js");
});

test("the bundle records which sources it was built from", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.ok(html.indexOf(build.sourceHash()) > 0);
});

// ---------- hosting ----------
const hosting = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8")).hosting;

test("every file the worker caches is published by hosting", () => {
  const files = [].concat(JSON.parse(/const REQUIRED = (\[[^\]]*\])/.exec(swSource)[1]), JSON.parse(/const OPTIONAL = (\[[^\]]*\])/.exec(swSource)[1]));
  const ignored = rel => hosting.ignore.some(g => {
    const re = new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "(.*/)?").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
    return re.test(rel);
  });
  files.filter(f => f !== "./").forEach(f => {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f + " exists");
    assert.ok(!ignored(f), f + " is not excluded from the deploy");
  });
});

test("the page and the worker are never served from the browser's HTTP cache", () => {
  const rule = source => hosting.headers.find(h => h.source === source);
  const noCache = h => h && h.headers.some(x => x.key === "Cache-Control" && x.value === "no-cache");
  assert.ok(noCache(rule("/")), "the root URL (what the home-screen icon opens) revalidates");
  const listed = hosting.headers.filter(h => /index\.html/.test(h.source) && noCache(h));
  assert.ok(listed.length && /sw\.js/.test(listed[0].source) && /sync-engine\.js/.test(listed[0].source));
});

// ---------- the worker, run against a fake network and cache ----------
function world(opts) {
  opts = opts || {};
  const stores = new Map(), log = { fetches: [] }, listeners = {};
  const key = r => (typeof r === "string" ? new URL(r, "https://app.test/").href : r.url);
  const server = opts.server || (() => new Response("fresh", { status: 200 }));
  const ctx = {
    console: { warn() {}, error() {}, log() {} },
    URL, Response, setTimeout: (fn, ms) => setTimeout(fn, ms > 100 ? 15 : ms), clearTimeout,
    self: { location: { origin: "https://app.test" }, addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting: () => { log.skipped = true; }, clients: { claim: async () => { log.claimed = true; } } },
    fetch: async (input, init) => {
      const url = key(input);
      log.fetches.push({ url, init });
      return server(url, init);
    }
  };
  ctx.caches = {
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      const cache = {
        put: async (r, res) => { m.set(key(r), res); },
        match: async r => { const v = m.get(key(r)); return v ? v.clone() : undefined; },
        add: async r => { const res = await ctx.fetch(key(r)); if (!res.ok) throw new TypeError("bad status " + res.status); m.set(key(r), res); },
        addAll: async list => { const got = await Promise.all(list.map(async r => { const res = await ctx.fetch(key(r)); if (!res.ok) throw new TypeError("bad status " + res.status + " for " + key(r)); return [key(r), res]; })); got.forEach(([k, v]) => m.set(k, v)); }
      };
      return cache;
    },
    match: async r => { for (const m of stores.values()) { const v = m.get(key(r)); if (v) return v.clone(); } return undefined; },
    keys: async () => [...stores.keys()],
    delete: async k => stores.delete(k)
  };
  vm.createContext(ctx);
  vm.runInContext(swSource, ctx);
  const request = (url, mode) => ({ method: "GET", url, mode: mode || "cors" });
  const handle = async req => {
    let out;
    listeners.fetch({ request: req, respondWith: p => { out = p; } });
    return out === undefined ? undefined : out;
  };
  return { ctx, stores, log, listeners, request, handle, key, install: () => { let p; listeners.install({ waitUntil: x => { p = x; } }); return p; } };
}
const body = async res => (res ? await res.text() : undefined);
const cached = (w, url) => { for (const m of w.stores.values()) { const v = m.get(w.key(url)); if (v) return v; } };

test("install survives one missing optional file and still caches the page", async () => {
  const w = world({ server: url => (url.endsWith("favicon.ico") ? new Response("nope", { status: 404 }) : new Response("ok:" + url, { status: 200 })) });
  await w.install();
  assert.ok(cached(w, "index.html") && cached(w, "./"), "the page is cached");
  assert.ok(cached(w, "sync-engine.js"));
  assert.equal(cached(w, "icons/favicon.ico"), undefined);
  assert.equal(w.log.skipped, true);
});

test("install fails (and keeps the old worker) when the page itself cannot be cached", async () => {
  const w = world({ server: url => (url.endsWith("index.html") ? new Response("", { status: 500 }) : new Response("ok", { status: 200 })) });
  await assert.rejects(w.install());
  assert.notEqual(w.log.skipped, true);
});

test("a good network answer is served and remembered", async () => {
  const w = world({ server: () => new Response("fresh", { status: 200 }) });
  const res = await w.handle(w.request("https://app.test/index.html", "navigate"));
  assert.equal(await body(res), "fresh");
  assert.equal(w.log.fetches[0].init.cache, "no-cache", "pages skip the HTTP cache");
  await new Promise(r => setImmediate(r));
  assert.ok(cached(w, "index.html"));
});

test("a server error or captive-portal page does not replace a good cached page", async () => {
  const w = world({ server: () => new Response("Service Unavailable", { status: 503 }) });
  (await w.ctx.caches.open("qalta-shell-x")).put("index.html", new Response("good shell"));
  const res = await w.handle(w.request("https://app.test/index.html", "navigate"));
  assert.equal(await body(res), "good shell");
});

test("a stalled connection falls back to the cache instead of hanging", async () => {
  const w = world({ server: () => new Promise(() => {}) });
  (await w.ctx.caches.open("qalta-shell-x")).put("index.html", new Response("good shell"));
  const res = await w.handle(w.request("https://app.test/index.html", "navigate"));
  assert.equal(await body(res), "good shell");
});

test("offline navigation to any page opens the cached shell", async () => {
  const w = world({ server: () => { throw new TypeError("Failed to fetch"); } });
  (await w.ctx.caches.open("qalta-shell-x")).put("index.html", new Response("good shell"));
  const res = await w.handle(w.request("https://app.test/somewhere", "navigate"));
  assert.equal(await body(res), "good shell");
});

test("the Firebase SDK is fetched with CORS, checked, cached, and then served without the network", async () => {
  const sdkUrl = "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js";
  const w = world({ server: () => new Response("sdk-code", { status: 200 }) });
  const first = await w.handle(w.request(sdkUrl, "no-cors"));
  assert.equal(await body(first), "sdk-code");
  assert.equal(w.log.fetches[0].init.mode, "cors");
  await new Promise(r => setImmediate(r));
  assert.ok(cached(w, sdkUrl), "stored");
  const before = w.log.fetches.length;
  const second = await w.handle(w.request(sdkUrl, "no-cors"));
  assert.equal(await body(second), "sdk-code");
  assert.equal(w.log.fetches.length, before, "second load did not touch the network");
});

test("a failing SDK response is passed through but never cached", async () => {
  const sdkUrl = "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js";
  const w = world({ server: () => new Response("boom", { status: 500 }) });
  await w.handle(w.request(sdkUrl, "no-cors"));
  await new Promise(r => setImmediate(r));
  assert.equal(cached(w, sdkUrl), undefined);
});

test("only the app and the SDK are intercepted; Firestore, Auth and writes go straight to the network", async () => {
  const w = world();
  assert.equal(await w.handle(w.request("https://firestore.googleapis.com/v1/x")), undefined);
  assert.equal(await w.handle(w.request("https://identitytoolkit.googleapis.com/v1/x")), undefined);
  assert.equal(await w.handle({ method: "POST", url: "https://app.test/index.html", mode: "cors" }), undefined);
});

test("activating removes caches of older releases", async () => {
  const w = world();
  await w.ctx.caches.open("qalta-shell-old");
  await w.ctx.caches.open(/const VERSION = "([^"]+)"/.exec(swSource)[1]);
  let p; w.listeners.activate({ waitUntil: x => { p = x; } });
  await p;
  assert.deepEqual(await w.ctx.caches.keys(), [/const VERSION = "([^"]+)"/.exec(swSource)[1]]);
  assert.equal(w.log.claimed, true);
});
