/*
 * SonoCBT app service worker (scope /). It makes the site installable and shows
 * a friendly page when a screen is opened with no connection. Pages are always
 * fetched from the network; nothing from a school is cached here. Exam pages
 * under /s/ are handled by exam-sw.js, which takes over that narrower scope.
 */
const VERSION = "app-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await cache.add(new Request(OFFLINE, { cache: "reload" }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("app-") && key !== VERSION) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch {
        return (await caches.match(OFFLINE)) ?? Response.error();
      }
    })(),
  );
});
