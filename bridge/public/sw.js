// Stage 1: minimal service worker so the app is installable. Caching and Web Push land in Stage 2.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
