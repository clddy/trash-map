/* 알림 엔진 — tools/simulate_alerts.py 의 규칙을 그대로 옮긴 것.
 *
 * 파이썬 시뮬레이터에서 지자체를 붙일 때마다 버그가 나왔고, 그때 정한 규칙들이 여기 다 들어 있다.
 * 나중에 네이티브 앱을 만들 때도 이 파일이 정답지 역할을 한다.
 *
 *   - 희소도: 주 6~7일 배출 가능한 품목에 '오늘 버리세요'는 소음이다
 *   - solo:   다른 품목이 전부 쉬는 날 혼자 가능한 품목은 알린다 (단 주 3일 이상이면 평상시)
 *   - streak: '오늘 버리세요'보다 '앞으로 N일 못 버립니다'가 행동을 바꾼다
 *             단 평소 간격보다 길어질 때만 (주1회 품목의 6일 공백은 뉴스가 아니다)
 *   - 중복:   배출일이 연달아 있으면 당일 알림이 전날 예고를 덮는다
 */

const WEEK = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const KO = { sun: "일", mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토" };
const BLACKOUT_KO = {
  saturday: "토요일", sunday: "일요일", friday: "금요일",
  holiday: "공휴일", day_before_holiday: "공휴일 전날",
};

const dayKey = d => WEEK[d.getDay()];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/* 배출 금지 판정. [금지여부, 사유, 확신도] */
function blackout(day, triggers, holidays) {
  if (!triggers || !triggers.length) return [false, null, "high"];
  const k = dayKey(day);
  for (const [name, code] of [["saturday", "sat"], ["sunday", "sun"], ["friday", "fri"]])
    if (triggers.includes(name) && k === code) return [true, BLACKOUT_KO[name], "high"];
  if (triggers.includes("holiday")) {
    const h = holidays[iso(day)];
    if (h) return [true, h.name, h.confidence];
  }
  if (triggers.includes("day_before_holiday")) {
    const h = holidays[iso(addDays(day, 1))];
    if (h) return [true, `내일 ${h.name}`, h.confidence];
  }
  return [false, null, "high"];
}

const dischargeable = (rule, day, holidays) => {
  if (!(rule.days || "").includes(KO[dayKey(day)])) return false;
  const [hit, , conf] = blackout(day, rule.blackout, holidays);
  return !(hit && conf === "high");
};

/* 알림 가치는 배출 가능일의 희소성에 반비례한다 */
function rarity(rule) {
  const n = (rule.days || "").length;
  if (!n) return "none";
  if (n <= 2) return "high";
  if (n <= 5) return "medium";
  return "low";
}

/* 공휴일을 뺀 평소 최대 간격 — 주1회 품목이 6일 비는 건 정상이다 */
function normalGap(rule) {
  const set = new Set((rule.days || "").split(""));
  if (!set.size) return null;
  let worst = 0;
  for (let i = 0; i < 7; i++) {
    if (!set.has(KO[WEEK[i]])) continue;
    let run = 0;
    while (run < 7 && !set.has(KO[WEEK[(i + 1 + run) % 7]])) run++;
    worst = Math.max(worst, run);
  }
  return worst;
}

/* 그날 실제로 배출 가능한 규칙들 */
const activeRules = (rules, day, holidays) =>
  rules.filter(r => !r.unsupported && dischargeable(r, day, holidays));

/* 평소보다 길게 못 버리게 될 때만 예고 */
function streakNotice(rules, day, holidays) {
  const primary = rules.find(r => r.key === "g" && !r.unsupported)
                || rules.find(r => !r.unsupported);
  if (!primary || !dischargeable(primary, day, holidays)) return null;
  let run = 0, cur = addDays(day, 1);
  while (run < 21 && !dischargeable(primary, cur, holidays)) { run++; cur = addDays(cur, 1); }
  const usual = normalGap(primary);
  if (run < 2 || usual == null || run <= usual) return null;
  return {
    at: "18:00", kind: "예고", label: "배출 금지 예고",
    title: `내일부터 ${run}일간 ${primary.label} 배출 금지`,
    body: `연휴·휴무가 겹쳐 평소보다 ${run - usual}일 깁니다. `
        + `오늘 안 내놓으면 ${cur.getMonth() + 1}/${cur.getDate()}(${KO[dayKey(cur)]})까지 기다려야 합니다.`,
  };
}

function itemTitle(rule, when) {
  const labels = (rule.items || []).map(i => i.label || i);
  if (!labels.length) return null;
  let head = labels.slice(0, 3).join(" · ");
  if (labels.length > 3) head += ` 외 ${labels.length - 3}종`;
  return `${when === "day_before" ? "내일은" : "오늘은"} ${head} 버리는 날이에요`;
}

/* 하루치 알림 목록 */
export function alertsFor(rules, day, holidays, policy = "smart") {
  const out = [];
  if (policy === "smart") {
    const s = streakNotice(rules, day, holidays);
    if (s) out.push(s);
  }

  // 혼자 가능한 날이 드물 때만 'OO만 버릴 수 있어요'
  let soloId = null;
  const act = activeRules(rules, day, holidays);
  if (act.length === 1) {
    const cand = act[0];
    let rare = 0;
    for (let i = 0; i < 7; i++) {
      const a = activeRules(rules, addDays(day, i), holidays);
      if (a.length === 1 && a[0].id === cand.id) rare++;
    }
    if (rare < 3) soloId = cand.id;
  }

  for (const rule of rules) {
    if (rule.unsupported || !rule.days) continue;
    const isSolo = rule.id === soloId;
    if (policy === "smart" && rarity(rule) === "low" && !isSolo) continue;

    // 배출일이 연달아 있으면 당일 알림이 전날 예고를 덮는다
    const firesToday = policy === "smart" && dischargeable(rule, day, holidays);

    for (const when of ["day_before", "on_day"]) {
      if (firesToday && when === "day_before") continue;
      const target = when === "on_day" ? day : addDays(day, 1);
      if (!(rule.days || "").includes(KO[dayKey(target)])) continue;
      const [hit, why, conf] = blackout(target, rule.blackout, holidays);
      if (hit && conf === "high") continue;

      let title = itemTitle(rule, when) || `${when === "on_day" ? "오늘" : "내일"} ${rule.label} 배출일`;
      let body = rule.time ? `${rule.time} 사이에 내놓으세요.` : "일몰 후에 내놓으세요.";
      if (isSolo && when === "on_day") {
        title = `오늘은 ${rule.label}만 버릴 수 있어요`;
        body = `다른 품목은 오늘 수거하지 않습니다. ${body}`;
      }
      out.push({
        at: when === "on_day" ? (rule.alertAt || "18:00") : "19:00",
        kind: when === "on_day" ? "오늘" : "내일",
        label: rule.label, title, body,
        warn: hit && conf !== "high" ? `${why}일 수 있음 — 공휴일 확정 전까지 보류` : null,
      });
    }
  }

  // 금지일 안내
  for (const n of rules.notices || []) {
    const [hit, why, conf] = blackout(day, [n.trigger], holidays);
    if (hit) out.push({
      at: n.at || "17:00", kind: "금지", label: "배출 금지",
      title: n.title, body: `${n.body} (${why})`,
      warn: conf !== "high" ? "공휴일 확정 전까지 보류" : null,
    });
  }

  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export { WEEK, KO, dayKey, iso, addDays, dischargeable, rarity, BLACKOUT_KO };
