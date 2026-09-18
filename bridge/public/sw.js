// Service worker: installable shell + Web Push (Stage 2).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let data = { title: "Continuation", body: "Update" };
  try { if (e.data) data = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, tag: "continuation" }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => {
    for (const c of cs) if ("focus" in c) return c.focus();
    return self.clients.openWindow ? self.clients.openWindow("./") : undefined;
  }));
});
