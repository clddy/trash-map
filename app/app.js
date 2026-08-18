import { alertsFor, WEEK, KO, dayKey, iso, addDays, dischargeable } from "./engine.js";

const D = window.APP;
const LS = "trash-alert-setting";
const $ = id => document.getElementById(id);

let S = load();
let tab = S.zoneId || S.regionId ? "today" : "setup";

function load() {
  try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; }
}
function save() { localStorage.setItem(LS, JSON.stringify(S)); }

const region = () => D.regions.find(r => r.id === S.regionId);
const zone = () => (region()?.zones || []).find(z => z.id === S.zoneId);

/* 선택한 구역에 적용되는 규칙 (공통 규칙 '*' 포함) */
function myRules() {
  const R = region();
  if (!R) return [];
  const list = R.rules.filter(r =>
    r.zoneId === "*" || r.zoneId === "all" || r.zoneId === S.zoneId);
  list.notices = R.notices || [];
  return list;
}

/* ── 전국 통합 검색 ──────────────────────────────────────────────
 * 시·도 → 시·군·구 → 동네 3단계 드롭다운은 이 앱에서 가장 번거로운 지점이다.
 * 김포는 마을이 410개, 안성은 549개라 목록을 훑는 게 현실적이지 않다.
 * 그래서 "우리 동네 이름"만 치면 전국에서 바로 찾게 한다.
 * 주소검색 API 없이 이미 가진 데이터만으로 되는 일이다.
 */
let SEARCH_INDEX = null;

function buildIndex() {
  if (SEARCH_INDEX) return SEARCH_INDEX;
  const idx = [];
  for (const r of D.regions) {
    const zs = r.zones.filter(z => z.id !== "all" && z.id !== "*");
    if (!zs.length) {
      idx.push({ rid: r.id, zid: "all", region: `${r.sido} ${r.name}`,
                 label: "전 지역", group: "", hay: r.name + r.sido,
                 hasDays: r.rules.some(x => x.days) });
      continue;
    }
    for (const z of zs) {
      idx.push({ rid: r.id, zid: z.id, region: `${r.sido} ${r.name}`,
                 label: z.label, group: z.group || "",
                 hay: r.name + z.label + (z.group || ""),
                 hasDays: r.rules.some(x => x.days &&
                          (x.zoneId === z.id || x.zoneId === "*" || x.zoneId === "all")) });
    }
  }
  SEARCH_INDEX = idx;
  return idx;
}

function searchZones(q) {
  q = q.trim();
  if (q.length < 2) return [];
  const idx = buildIndex();
  // 요일 데이터가 있는 곳을 먼저, 그 다음 짧은 라벨(더 정확한 매칭) 순
  return idx
    .filter(e => e.hay.includes(q))
    .sort((a, b) => (b.hasDays - a.hasDays) || (a.label.length - b.label.length))
    .slice(0, 60);
}

/* ── 화면: 오늘 ── */
function viewToday() {
  const R = region(), rules = myRules();
  const today = new Date();
  const act = rules.filter(r => !r.unsupported && r.days && dischargeable(r, today, D.holidays));
  const alerts = alertsFor(rules, today, D.holidays);

  let h = `<div class="today">`;
  if (act.length) {
    const names = act.flatMap(r => r.items.length ? r.items : [r.label]);
    const uniq = [...new Set(names)];
    h += `<div class="big">오늘은 ${uniq.slice(0, 4).join(" · ")}` +
         `${uniq.length > 4 ? ` 외 ${uniq.length - 4}종` : ""}<br>버리는 날이에요</div>`;
    h += `<div class="chips">` + act.map(r =>
      `<span class="chip${r.key === "v" ? " v" : ""}">${r.label}</span>`).join("") + `</div>`;
    const times = [...new Set(act.map(r => r.time).filter(Boolean))];
    if (times.length) h += `<div class="sub">⏰ ${times.join(" / ")}</div>`;
  } else {
    const notice = alerts.find(a => a.kind === "금지");
    h += `<div class="big none">오늘은 버리는 날이 아니에요</div>`;
    if (notice) h += `<div class="chips"><span class="chip off">${notice.title}</span></div>`;
    const next = nextDay(rules, today);
    if (next) h += `<div class="sub">다음 배출일: <b>${next.label}</b> — ${next.what}</div>`;
  }
  h += `</div>`;

  if (alerts.length) {
    h += `<div class="sec">📣 알림</div>`;
    for (const a of alerts) {
      const cls = a.kind === "금지" ? "notice" : a.kind === "예고" ? "warn-ahead" : "";
      h += `<div class="alert ${cls}">
        <div class="when">${a.at} · ${a.kind}</div>
        <div class="t">${a.title}</div>
        <div class="b">${a.body}</div>
        ${a.warn ? `<div class="flag">⚠ ${a.warn}</div>` : ""}
      </div>`;
    }
  }

  h += weekTable(rules, today);

  const gaps = rules.filter(r => r.unsupported);
  if (gaps.length) {
    h += `<div class="sec">🚫 데이터가 없는 항목</div>`;
    for (const g of gaps)
      h += `<div class="card danger"><b>${g.label}</b>${g.why || ""}</div>`;
  }
  const z = zone();
  if (z?.collector)
    h += `<div class="card warn"><b>📞 우리 구역 담당 수거업체</b>${z.collector}<br>
          <span style="color:var(--sub);font-size:12px">골목별 요일은 이 업체가 압니다 — 한 번만 확인하면 됩니다</span></div>`;

  const low = rules.filter(r => r.confidence === "medium" && !r.unsupported);
  if (low.length)
    h += `<div class="card warn"><b>⚠ 확인이 필요한 값</b>
          ${low.map(r => `${r.label}: ${r.note || "원문 미확인"}`).join("<br>")}</div>`;

  return h;
}

function nextDay(rules, from) {
  for (let i = 1; i <= 14; i++) {
    const d = addDays(from, i);
    const act = rules.filter(r => !r.unsupported && r.days && dischargeable(r, d, D.holidays));
    if (act.length) {
      const names = [...new Set(act.map(r => r.label))];
      return {
        label: `${d.getMonth() + 1}/${d.getDate()}(${KO[dayKey(d)]})` + (i === 1 ? " 내일" : ` ${i}일 뒤`),
        what: names.join(" · "),
      };
    }
  }
  return null;
}

function weekTable(rules, today) {
  const t = KO[dayKey(today)];
  const rows = rules.filter(r => !r.unsupported && r.days);
  if (!rows.length) return "";
  const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
  let h = `<div class="sec">🗓️ 이번 주</div><div class="week">
    <div class="row hd"><div class="cell nm">품목</div>${
      DAYS.map(d => `<div class="cell${d === t ? " t" : ""}">${d}</div>`).join("")}</div>`;
  for (const r of rows) {
    h += `<div class="row"><div class="cell nm">${r.label}<small>${r.time || ""}</small></div>` +
      DAYS.map(d => `<div class="cell${d === t ? " t" : ""}">${
        r.days.includes(d) ? `<span class="dot${r.key === "v" ? " v" : ""}"></span>`
                           : `<span class="off">·</span>`}</div>`).join("") + `</div>`;
  }
  return h + `</div>`;
}

/* ── 화면: 설정 ── */
function viewSetup() {
  const bySido = {};
  for (const r of D.regions) (bySido[r.sido] ||= []).push(r);
  const R = region();

  // 검색이 기본, 드롭다운은 못 찾을 때의 대안
  let h = `<label class="f">우리 동네 이름으로 찾기</label>
    <input id="gq" placeholder="예: 주안8동, 정릉4동, 대룡리" value="${(S._q || "").replace(/"/g, "&quot;")}">
    <div class="hint">동·리·마을 이름을 두 글자 이상 입력하세요. 전국에서 찾습니다.</div>
    <div id="gres"></div>

    <div style="height:1px;background:var(--line);margin:24px 0 4px"></div>
    <div class="hint" style="margin-bottom:2px">못 찾으시겠으면 아래에서 직접 고르세요</div>

    <label class="f">1. 시·도</label>
    <select id="sido">${Object.keys(bySido).map(s =>
      `<option${R && R.sido === s ? " selected" : ""}>${s}</option>`).join("")}</select>

    <label class="f">2. 시·군·구</label>
    <select id="sgg"></select>`;

  if (R) {
    const zs = R.zones.filter(z => z.id !== "all" && z.id !== "*");
    if (zs.length) {
      h += `<label class="f">3. ${R.zoneLabel || "우리 동네"}</label>`;
      if (zs.length > 12) h += `<input id="zq" placeholder="동·마을 이름 검색">`;
      h += `<div class="zlist" id="zlist"></div>`;
    } else {
      h += `<div class="hint" style="margin-top:14px">${R.name}는 전 지역이 같은 규칙이라 동네를 고르지 않아도 됩니다.</div>`;
    }
    h += `<div class="hint">${R.note || ""}</div>`;
  }

  h += `<button class="big" id="saveBtn"${R ? "" : " disabled"}>저장하고 시작하기</button>`;
  if (S.regionId) h += `<button class="big ghost" id="cancelBtn">취소</button>`;
  return h;
}

function bindSetup() {
  const bySido = {};
  for (const r of D.regions) (bySido[r.sido] ||= []).push(r);

  // ── 전국 통합 검색 ──
  const gq = $("gq"), gres = $("gres");
  const drawSearch = () => {
    const q = gq.value;
    S._q = q;
    const hits = searchZones(q);
    if (q.trim().length < 2) { gres.innerHTML = ""; return; }
    if (!hits.length) {
      gres.innerHTML = `<div class="hint" style="margin-top:10px">
        '${q}'로 찾은 곳이 없습니다. 아래에서 직접 골라주세요.</div>`;
      return;
    }
    gres.innerHTML = `<div class="zlist" style="margin-top:10px">` + hits.map((e, i) =>
      `<div class="zitem" data-i="${i}">
        <small>${e.region}${e.group ? " · " + e.group : ""}${e.hasDays ? "" : " · 요일 데이터 없음"}</small>
        ${e.label}</div>`).join("") + `</div>`;
    gres.querySelectorAll(".zitem").forEach(n => n.onclick = () => {
      const e = hits[+n.dataset.i];
      S.regionId = e.rid; S.zoneId = e.zid; delete S._q;
      save(); tab = "today"; render();
    });
  };
  gq.oninput = drawSearch;
  drawSearch();

  const sido = $("sido"), sgg = $("sgg");
  const fillSgg = () => {
    const list = bySido[sido.value] || [];
    sgg.innerHTML = list.map(r =>
      `<option value="${r.id}"${r.id === S.regionId ? " selected" : ""}>${r.name}</option>`).join("");
  };
  fillSgg();
  sido.onchange = () => { fillSgg(); S.regionId = sgg.value; S.zoneId = null; render(); };
  sgg.onchange = () => { S.regionId = sgg.value; S.zoneId = null; render(); };
  if (!S.regionId && sgg.value) { S.regionId = sgg.value; render(); return; }

  const R = region();
  const zs = (R?.zones || []).filter(z => z.id !== "all" && z.id !== "*");
  const drawZ = () => {
    const q = ($("zq")?.value || "").trim();
    const list = q ? zs.filter(z => (z.group + z.label).includes(q)) : zs;
    const el = $("zlist");
    if (!el) return;
    el.innerHTML = list.slice(0, 200).map(z =>
      `<div class="zitem${z.id === S.zoneId ? " sel" : ""}" data-id="${z.id}">
        ${z.group ? `<small>${z.group}</small>` : ""}${z.label}</div>`).join("")
      || `<div class="zitem">검색 결과가 없습니다</div>`;
    el.querySelectorAll(".zitem[data-id]").forEach(n => n.onclick = () => {
      S.zoneId = n.dataset.id; drawZ();
    });
  };
  if (zs.length) { drawZ(); if ($("zq")) $("zq").oninput = drawZ; }

  $("saveBtn").onclick = () => {
    if (zs.length && !S.zoneId) { alert("우리 동네를 골라주세요."); return; }
    if (!zs.length) S.zoneId = "all";
    save(); tab = "today"; render();
  };
  if ($("cancelBtn")) $("cancelBtn").onclick = () => { S = load(); tab = "today"; render(); };
}

/* ── 화면: 알림 설정 ── */
function viewNotify() {
  const perm = ("Notification" in window) ? Notification.permission : "unsupported";
  const label = { granted: "허용됨", denied: "차단됨", default: "아직 안 물어봄", unsupported: "이 브라우저는 지원 안 함" }[perm];
  return `
    <div class="sec">🔔 알림</div>
    <div class="card"><b>현재 상태: ${label}</b>
      ${perm === "granted"
        ? "배출일 저녁에 알려드립니다. 앱을 홈 화면에 추가해두면 더 잘 동작합니다."
        : perm === "denied"
        ? "브라우저 설정에서 이 사이트의 알림을 다시 허용해주세요."
        : "알림을 켜면 배출일과 금지일을 미리 알려드립니다."}</div>
    ${perm === "default" ? `<button class="big" id="askBtn">알림 켜기</button>` : ""}
    ${perm === "granted" ? `<button class="big ghost" id="testBtn">테스트 알림 보내기</button>` : ""}

    <div class="sec">📲 홈 화면에 추가</div>
    <div class="card">
      안드로이드 크롬은 <b>⋮ → 홈 화면에 추가</b>,
      아이폰 사파리는 <b>공유 → 홈 화면에 추가</b>를 누르면
      앱처럼 아이콘이 생깁니다.
    </div>

    <div class="sec">⚠️ 알림의 한계 (솔직하게)</div>
    <div class="card warn">
      <b>이 앱은 "매일 저녁 7시 알림"을 보장하지 못합니다.</b>
      웹앱은 브라우저가 깨워줄 때만 알림을 보낼 수 있고, 그 시점을 앱이 정할 수 없습니다.<br><br>
      그래서 지금은 <b>앱을 열면 그날 알림이 항상 보이도록</b> 만들어 뒀고,
      브라우저가 백그라운드로 깨워주면 그때 알림도 함께 보냅니다.<br><br>
      정확한 시각 알림과 홈 화면 위젯은 <b>안드로이드 앱으로 만들어야</b> 됩니다.
      지금 버전은 요일 데이터와 알림 문구가 제대로인지 확인하는 단계입니다.
    </div>

    <div class="sec">⚠️ 데이터에 대하여</div>
    <div class="card warn">
      배출요일은 <b>지자체가 바꿀 수 있습니다.</b> 이 앱의 데이터 기준일은
      <b>${D.updated}</b>이고, 이상하면 정보 탭의 담당 부서에 확인해주세요.<br>
      음력 공휴일(설·추석 등)은 아직 검증 전이라, 그 기간 알림은 보내지 않습니다.
    </div>`;
}

/* ── 화면: 정보 ── */
function viewInfo() {
  const R = region();
  if (!R) return `<div class="empty">먼저 지역을 설정해주세요.</div>`;
  let h = `<div class="sec">📍 ${R.sido} ${R.name}</div>
    <div class="card"><b>${R.badge === "full" ? "전수 구축" : R.badge === "gap" ? "데이터 공백" : "부분 구축"}</b>${R.note}</div>`;
  if (R.facts?.length)
    h += `<div class="sec">확인한 사실</div><div class="card">${
      R.facts.map(f => "• " + f.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")).join("<br>")}</div>`;
  h += `<div class="sec">☎️ 문의</div>` +
    Object.entries(R.contacts || {}).map(([k, v]) =>
      `<div class="row2"><b>${k}</b><span><a href="tel:${v.replace(/[^0-9]/g, "")}" style="color:var(--accent)">${v}</a></span></div>`).join("");
  h += `<div class="sec">데이터</div>
    <div class="card">기준일 ${D.updated} · 지역 ${D.regions.length}곳<br>
    <span style="color:var(--sub);font-size:12px">
    지자체 공식 페이지·공고에서 직접 수집했습니다. 없는 값은 지어내지 않고 '데이터 없음'으로 표시합니다.</span></div>`;
  return h;
}

/* ── 렌더 ── */
function render() {
  const R = region();
  const z = zone();
  const now = new Date();

  $("hd").innerHTML = R
    ? `<div class="loc">${R.sido} ${R.name}${z && z.id !== "all" ? ` · ${z.label.slice(0, 24)}` : ""}</div>
       <h1>오늘 뭐 버리지</h1>
       <div class="date">${now.getMonth() + 1}월 ${now.getDate()}일 ${KO[dayKey(now)]}요일</div>`
    : `<h1>오늘 뭐 버리지</h1>
       <div class="date">우리 동네 배출요일 알리미</div>`;

  const views = { today: viewToday, setup: viewSetup, notify: viewNotify, info: viewInfo };
  $("view").innerHTML = (S.regionId && S.zoneId) || tab === "setup"
    ? views[tab]()
    : `<div class="empty">아직 지역을 설정하지 않았어요.<br>아래 <b>설정</b> 탭에서 우리 동네를 골라주세요.</div>`;

  const tabs = [["today", "🗑️", "오늘"], ["notify", "🔔", "알림"], ["info", "ℹ️", "정보"], ["setup", "⚙️", "설정"]];
  $("nav").innerHTML = tabs.map(([k, i, t]) =>
    `<button class="${tab === k ? "on" : ""}" data-tab="${k}"><span class="i">${i}</span>${t}</button>`).join("");
  $("nav").querySelectorAll("button").forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });

  if (tab === "setup") bindSetup();
  if (tab === "notify") {
    if ($("askBtn")) $("askBtn").onclick = async () => { await Notification.requestPermission(); render(); };
    if ($("testBtn")) $("testBtn").onclick = () => {
      const a = alertsFor(myRules(), new Date(), D.holidays)[0];
      new Notification(a ? a.title : "오늘은 버리는 날이 아니에요",
        { body: a ? a.body : "다음 배출일에 알려드릴게요.", icon: "icon.png" });
    };
  }
}

/* ── 알림 연동 ──────────────────────────────────────────────────
 * 웹은 예약 알림을 보장하지 못한다(그래서 결국 네이티브가 필요하다).
 * 대신 앱을 열 때마다 오늘치 알림을 서비스워커에 넘겨두고,
 * 브라우저가 백그라운드로 깨워주면 그때 발송한다.
 */
async function syncPending(reg) {
  if (!S.regionId || !S.zoneId) return;
  const items = alertsFor(myRules(), new Date(), D.holidays)
    .filter(a => !a.warn)          // 확신도 낮은 건 안 보낸다
    .map(a => ({ title: a.title, body: a.body }));
  const payload = { date: iso(new Date()), items };
  reg.active?.postMessage({ type: "pending", payload });

  // 하루 한 번 깨워달라고 등록 (허락 여부는 브라우저가 정한다)
  try {
    if ("periodicSync" in reg) {
      const st = await navigator.permissions.query({ name: "periodic-background-sync" });
      if (st.state === "granted")
        await reg.periodicSync.register("daily-check", { minInterval: 12 * 60 * 60 * 1000 });
    }
  } catch (_) { /* 미지원 브라우저 — 앱을 열면 보이니 문제없다 */ }
}

render();
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js")
    .then(reg => navigator.serviceWorker.ready.then(() => syncPending(reg)))
    .catch(() => {});
}
