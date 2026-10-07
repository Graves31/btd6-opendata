// App-shell service worker: the page itself opens from disk (no network round trip), then updates in the
// background. /api/* is left to the app's own store (memory + IndexedDB), which knows each key's freshness.
// Stamped per build by vite.config.ts (stampServiceWorker): a new deploy = a new worker = a new cache; the
// activate handler below deletes every older build's cache, so stale bundles and sprite sheets never pile up.
const CACHE = "shell-__BUILD__";
// The site moved to btd6data.com. On the old workers.dev address this worker clears its cache, unregisters
// and reloads the open tabs, so their next page load reaches the Worker and its redirect.
const RETIRED = location.hostname.endsWith(".workers.dev");

self.addEventListener("install", (e) => {
  self.skipWaiting();
  if (!RETIRED) e.waitUntil(caches.open(CACHE).then((c) => c.add("/")));
});

self.addEventListener("activate", (e) => {
  if (RETIRED) {
    e.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.matchAll({ type: "window" }))
        .then((tabs) => Promise.all(tabs.map((t) => t.navigate(t.url).catch(() => {})))),
    );
    return;
  }
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (RETIRED || req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  // Any in-app URL → the cached shell (stale-while-revalidate).
  if (req.mode === "navigate") {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match("/");
        const fresh = fetch("/").then((res) => {
          if (res.ok) c.put("/", res.clone());
          return res;
        });
        if (cached) {
          e.waitUntil(fresh.catch(() => {}));
          return cached;
        }
        return fresh;
      }),
    );
    return;
  }

  // Content-hashed bundles never change: cache-first.
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
  }
});
