// Қalta offline shell. Keeps the app launchable with no network; data itself is
// stored by the app (localStorage + Firestore's offline cache), not here.
// tools/build.js rewrites VERSION from the shipped files, so every release starts with a clean cache.
const VERSION = "qalta-shell-c3e43e6a";
const REQUIRED = ["./", "index.html"];
const OPTIONAL = ["manifest.json", "firebase-config.js", "sync-engine.js", "cat-model.json",
  "icons/icon-192.png", "icons/icon-512.png", "icons/favicon.ico"];
const NETWORK_WAIT = 4000;

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION).then(cache =>
      // The page itself must be cached; the rest is best effort, so one missing file cannot
      // leave the app without an offline shell.
      cache.addAll(REQUIRED).then(() => Promise.all(OPTIONAL.map(u =>
        cache.add(u).catch(err => console.warn("[qalta sw] not cached: " + u, err)))))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Only answers that can be read and are good are worth keeping: an error page or an opaque
// response (status unknown) would otherwise be served from the cache for good.
function keep(key, res) {
  if (res && res.ok && res.type !== "opaque") caches.open(VERSION).then(c => c.put(key, res)).catch(() => {});
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, err => { clearTimeout(t); reject(err); });
  });
}

// Same-origin files: the network when it answers properly and quickly, the cached copy when it does
// not (offline, a server error, a captive portal, a stalled connection). Pages skip the HTTP cache.
function networkFirst(req) {
  const nav = req.mode === "navigate";
  const net = (nav ? fetch(req.url, { cache: "no-cache" }) : fetch(req)).then(res => { keep(req, res.clone()); return res; });
  net.catch(() => {});   // a failure after the timeout has nobody left to report to
  return withTimeout(net, NETWORK_WAIT)
    .then(res => res.ok ? res : caches.match(req).then(hit => hit || res))
    .catch(() => caches.match(req).then(hit => hit || (nav ? caches.match("index.html") : Response.error())));
}

// Versioned Firebase SDK files never change: serve from cache once fetched. A page script request is
// opaque, so the worker fetches the file itself with CORS, which lets it check the status first.
function sdk(req) {
  return caches.match(req.url).then(hit => hit ||
    fetch(req.url, { mode: "cors", credentials: "omit" })
      .then(res => { if (!res.ok) throw new Error("SDK request failed: " + res.status); keep(req.url, res.clone()); return res; })
      .catch(() => fetch(req)));
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) e.respondWith(sdk(req));
  // everything else (Firestore, Auth, Google APIs) goes straight to the network
});
