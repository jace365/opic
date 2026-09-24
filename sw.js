/* 오프라인 캐시: 앱 파일은 먼저 캐시에서, 새 버전은 뒤에서 받아 둡니다. 파일을 고치면 VERSION을 올리세요. */
const VERSION = "opicwalk-v5";
const SHELL = ["./", "index.html", "native-bridge.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  const cacheable = url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!cacheable) return;
  if (req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/")) {
    // 앱 화면은 항상 최신본 먼저(오프라인이면 캐시)
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(h => h || caches.match("index.html"))));
    return;
  }
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
    const net = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
