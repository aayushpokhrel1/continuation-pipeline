// Service worker: installable shell + offline cache + Web Push (Stage 2, Slice C).
const CACHE = "continuation-v1";
const SHELL = ["./", "index.html", "app.js", "styles.css", "manifest.webmanifest", "icon.svg", "icon-180.png"];
// Dynamic endpoints must always hit the network (never cached/served stale).
const BYPASS = ["/ws", "/repos", "/vapid", "/subscribe", "/health"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  ]));
});

// Network-first for the app shell: fresh when online, cached when offline.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (BYPASS.includes(url.pathname)) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match("index.html")))
  );
});

self.addEventListener("push", (e) => {
  let data = { title: "Continuation", body: "Update" };
  try { if (e.data) data = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.sessionId || "continuation",
    data: { sessionId: data.sessionId || null },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.sessionId;
  const url = id ? "./?session=" + encodeURIComponent(id) : "./";
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => {
    for (const c of cs) {
      if ("focus" in c) { if (id && "navigate" in c) c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
  }));
});
