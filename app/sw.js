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

/* ── 알림 ────────────────────────────────────────────────────────
 * 웹은 "매일 저녁 7시에 깨워줘"를 보장하지 못한다. 그게 이 앱의 한계이고
 * 결국 네이티브로 가야 하는 이유다. 다만 할 수 있는 만큼은 한다.
 *
 *  1) Periodic Background Sync — 크롬이 지원하면 하루 한 번 깨워준다.
 *     설치형(홈 화면 추가)이고 사용 빈도가 높아야 브라우저가 허락한다.
 *  2) 알림 클릭 시 앱 열기
 *
 * 실제로 안 깨워줄 수 있으므로, 앱을 열었을 때도 그날 알림을 항상 보여준다.
 */
self.addEventListener("periodicsync", e => {
  if (e.tag === "daily-check") e.waitUntil(notifyToday());
});
self.addEventListener("sync", e => {
  if (e.tag === "daily-check") e.waitUntil(notifyToday());
});

async function notifyToday() {
  try {
    const cache = await caches.open(V);
    const res = await cache.match("./pending.json");
    if (!res) return;
    const p = await res.json();
    const today = new Date().toISOString().slice(0, 10);
    if (!p || p.date !== today || !p.items || !p.items.length) return;
    const first = p.items[0];
    await self.registration.showNotification(first.title, {
      body: first.body + (p.items.length > 1 ? `
외 ${p.items.length - 1}건` : ""),
      icon: "./icon-192.png", badge: "./icon-192.png",
      tag: "trash-" + today, renotify: false,
    });
  } catch (_) { /* 조용히 실패 — 앱을 열면 어차피 보인다 */ }
}

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then(cs => (cs.length ? cs[0].focus() : self.clients.openWindow("./"))));
});

/* 앱이 오늘치 알림을 계산해서 넘겨주면 캐시에 적어둔다 */
self.addEventListener("message", e => {
  if (e.data && e.data.type === "pending") {
    e.waitUntil(caches.open(V).then(c =>
      c.put("./pending.json", new Response(JSON.stringify(e.data.payload),
        { headers: { "Content-Type": "application/json" } }))));
  }
});
