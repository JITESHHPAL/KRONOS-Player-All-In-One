const C = "player-v8";
const FILES = ["./", "index.html", "player.css", "player.js", "media.js", "icon-192.png", "icon-512.png", "manifest.webmanifest"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(C).then((c) => c.addAll(FILES))));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== C).map((x) => caches.delete(x))))));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname.startsWith("/media/") || u.pathname.startsWith("/cache/")) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(C).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
