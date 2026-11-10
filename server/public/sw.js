// Service worker for the installable app (ui.pwa, idea 493). Network first, so players always get the live game;
// the last good copy of the page, scripts and images is kept so the app still opens (and shows "reconnecting")
// when the connection drops. The game itself needs the server: nothing about trading works offline.
const CACHE = "manifest-shell-v1";
const SHELL = ["/", "/index.html", "/style.css", "/app.js", "/features/api.js", "/manifest.webmanifest", "/img/icon.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/ws") || url.pathname.startsWith("/api")) return;
  event.respondWith(fetch(event.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); }
    return res;
  }).catch(() => caches.match(event.request).then(hit => hit ?? caches.match("/index.html"))));
});
