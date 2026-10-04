/*
 * SonoCBT exam service worker (scope /s/). Its only job: let an exam page that
 * was already open reopen without a connection. Exam pages are network-first
 * (always fresh when online); Next's hashed static files and question images
 * are cache-first. Nothing else is touched. Answers live in IndexedDB, not here.
 */
const VERSION = "v2";
const PAGES = `exam-pages-${VERSION}`;
const ASSETS = `exam-assets-${VERSION}`;
const TAKE = /^\/s\/[^/]+\/exam\/[^/]+\/take\/?$/;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (!key.endsWith(VERSION)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(request);
    if (res.ok && !res.redirected) await cache.put(request.url, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request.url);
    if (hit) return hit;
    return new Response(
      "<!doctype html><meta name=viewport content='width=device-width'><title>Offline</title><body style='font-family:system-ui;padding:32px;background:#faf8f3;color:#14213d'><h1 style='font-size:22px'>You're offline</h1><p>This exam hasn't been opened on this device yet. Reconnect, then open it again. Your invigilator can help.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate" && TAKE.test(url.pathname)) {
    event.respondWith(networkFirst(req));
  } else if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/files/")) {
    event.respondWith(cacheFirst(req));
  }
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "warm" && Array.isArray(msg.urls)) {
    // The page lists its own URL and every file it uses. Files first, the page last,
    // then tell the page it can now reopen with no connection.
    event.waitUntil(
      (async () => {
        const pages = await caches.open(PAGES);
        const assets = await caches.open(ASSETS);
        const urls = [...new Set(msg.urls)]
          .map((u) => {
            try {
              return new URL(u, self.location.origin);
            } catch {
              return null;
            }
          })
          .filter((u) => u && u.origin === self.location.origin);
        const isAsset = (u) => u.pathname.startsWith("/_next/static/") || u.pathname.startsWith("/files/");
        let missed = 0;
        await Promise.all(
          urls.filter(isAsset).map(async (u) => {
            try {
              if (await assets.match(u.href)) return;
              const res = await fetch(u.href);
              if (res.ok) await assets.put(u.href, res);
              else missed++;
            } catch {
              missed++;
            }
          }),
        );
        for (const u of urls.filter((x) => TAKE.test(x.pathname))) {
          try {
            const res = await fetch(u.href, { credentials: "same-origin" });
            if (res.ok && !res.redirected) await pages.put(u.href, res);
            else missed++;
          } catch {
            missed++;
          }
        }
        event.source?.postMessage({ type: "warmed", ok: missed === 0 });
      })(),
    );
  } else if (msg.type === "forget" && msg.url) {
    // Submitted: don't keep this student's exam page on a shared computer.
    event.waitUntil(caches.open(PAGES).then((c) => c.delete(new URL(msg.url, self.location.origin).href)));
  }
});
