/* 오프라인 캐시 — 데이터가 1MB라 한 번 받으면 네트워크 없이도 동작해야 한다 */
const V = "trash-v1";
const ASSETS = ["./", "./index.html", "./app.js", "./engine.js", "./data.js", "./manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // 네트워크 우선, 실패하면 캐시 (데이터 갱신이 늦게 반영되는 걸 막는다)
  e.respondWith(
    fetch(e.request)
      .then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request))
  );
});
