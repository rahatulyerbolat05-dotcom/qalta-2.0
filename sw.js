// Қalta offline shell. Keeps the app launchable with no network; data itself is
// stored by the app (localStorage + Firestore's offline cache), not here.
const VERSION = "qalta-shell-v1";
const SHELL = ["./", "index.html", "manifest.json", "firebase-config.js", "sync-engine.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/favicon.ico"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function store(req, res) {
  if (res && (res.ok || res.type === "opaque")) {
    const copy = res.clone();
    caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
  }
  return res;
}

// Same-origin files: fresh when online, cached copy when offline.
function networkFirst(req) {
  return fetch(req).then(res => store(req, res)).catch(() =>
    caches.match(req).then(hit => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))
  );
}

// Versioned Firebase SDK files never change: serve from cache once fetched.
function cacheFirst(req) {
  return caches.match(req).then(hit => hit || fetch(req).then(res => store(req, res)));
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) e.respondWith(cacheFirst(req));
  // everything else (Firestore, Auth, Google APIs) goes straight to the network
});
