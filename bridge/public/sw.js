// Service worker: installable shell + Web Push (Stage 2).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
