# Design — 재고 부족 예상 전역 알림 (inventory-shortage-alert)

> PDCA Design · 2026-06-08 · Plan: [[inventory-shortage-alert]] · 패턴 출처: [[unmapped-products-badge]]

## 1. 설계 개요

`computeInkMetrics().weeklyNeed < 0`(공식 부족 정의)을 전역 알림에 연결한다.
신규 계산 없음 — 기존 함수 합성 + 순수 코어 1개 신설 + 전역 UI 와이어링.

```
data ──┬─ buildProductLookup ──┐
       ├─ buildDemandByInkDay ──┤
       ├─ buildInventoryByInkDay┤(dates)
       ├─ mergeInkPlanAndTestInks┤
       └──────────────────────┴─ computeInkMetrics ─→ computedByInk
                                                          │
                              merged ──┐                  │
                                       ▼                  ▼
                              collectInkShortage(merged, computedByInk)
                                       │  (weeklyNeed<0 수집·정렬)
                                       ▼
                        { shortageCount, items, show, tooltip }
                                       │
                  ┌────────────────────┴────────────────────┐
            사이드바 ink-plan 주황 배지              헤더 bell(마스터와 통합)
```

## 2. data-service.js — 순수 로직

### 2.1 신규: `collectInkShortage(merged, computedByInk)` (순수 코어 · 테스트 대상)

```js
// 잉크 부족 신호 수집: weeklyNeed < 0(월요일 현재고로 주간 총소요 불가)인 잉크.
// 단일 출처 = computeInkMetrics().weeklyNeed (ink-plan 페이지 빨강 표시와 동일 기준).
function collectInkShortage(merged, computedByInk) {
  const items = [];
  for (const ink of (merged || [])) {
    const wn = computedByInk.get(ink.name)?.get('월')?.weeklyNeed;
    if (wn != null && Number(wn) < 0) {
      items.push({ ink: ink.name, weeklyNeed: Number(wn) });
    }
  }
  items.sort((a, b) => a.weeklyNeed - b.weeklyNeed); // 가장 부족한 순
  const n = items.length;
  const names = items.slice(0, 3).map(i => i.ink).join(' · ');
  return {
    shortageCount: n,
    items,
    show: n > 0,
    tooltip: n > 0 ? `재고 부족 임박 ${n}건 — ${names}${n > 3 ? ' 외' : ''}` : '재고 정상',
  };
}
```

- `weeklyNeed`는 `computeInkMetrics`에서 **'월'요일에만** 산출(`d === '월'` 조건, data-service.js:829). → '월'만 조회.
- `stock=null`(현재고 미입력)이면 `weeklyNeed=null` → **자동 제외**(오탐 방지, Plan 리스크 대응).

### 2.2 신규: `buildInkShortageBadge(data, dates)` (조립 어댑터 · app용)

```js
function buildInkShortageBadge(data, dates) {
  const days = WEEKDAYS;
  const productLookup    = buildProductLookup(data.products);
  const demandByInkDay   = buildDemandByInkDay(data.injection, productLookup);
  const inventoryByInkDay = buildInventoryByInkDay(data.inventory, dates);
  const merged           = mergeInkPlanAndTestInks(data.inkPlan, data.testInks, days);
  const computedByInk    = computeInkMetrics(merged, demandByInkDay, inventoryByInkDay, days);
  return collectInkShortage(merged, computedByInk);
}
```
- ink-plan.jsx와 **동일 함수 합성**(로직 중복 아님 — 호출 합성). 결과는 페이지 표시와 100% 일치.
- export: `collectInkShortage`, `buildInkShortageBadge` 둘 다 (코어는 테스트, 어댑터는 app).

## 3. app.jsx — 전역 와이어링

### 3.1 파생 (masterHealth 옆, ~line 231)
```js
const inkShortage = useMemo(
  () => DataService.buildInkShortageBadge(data, weekInfo.dates),
  [data, weekInfo.dates]
);
```

### 3.2 헤더 bell 통합 (현 285–290 교체) — bell = 통합 알림 센터
```js
const bellCount = (masterHealth.show ? masterHealth.errorCount : 0) + inkShortage.shortageCount;
const bellShow  = masterHealth.show || inkShortage.show;
const bellTip   = [masterHealth.show ? masterHealth.tooltip : null,
                   inkShortage.show ? inkShortage.tooltip : null]
                  .filter(Boolean).join(' / ') || '처리 필요 알림 없음';
// 심각도 우선: 마스터 error는 빨강·data-quality, 그 외 재고만이면 주황·ink-plan
const bellTone  = masterHealth.show ? 'bad' : 'warn';
const bellTo    = masterHealth.show ? 'data-quality' : 'ink-plan';
```
- 버튼: `title={bellTip}`, `onClick={() => bellShow && setView(bellTo)}`,
  배경/테두리/글자 = `bellTone==='bad' ? --bad-* : --warn-*`(현재 인라인 스타일 패턴 유지 + fallback),
  카운트 `{bellShow && <span>{bellCount}</span>}`.
- **회귀 가드**: 마스터 error>0 동작(빨강 + data-quality)은 기존과 동일 유지.

### 3.3 사이드바 ink-plan 배지 (현 321–324 블록에 추가)
```jsx
{item.id === 'ink-plan' && inkShortage.show && (
  <span className="sb-item__badge sb-item__badge--warn" title={inkShortage.tooltip}>
    {inkShortage.shortageCount}
  </span>
)}
```

### 3.4 버전
- `APP_REV` 54 → 55
- index.html: `app.jsx?v=` / `styles.css?v=` 현재값 → +1 (캐시 무효화, [[unmapped-products-badge]] 교훈)

## 4. styles.css — 주황 배지 변형

기존 `.sb-item__badge--alert`(빨강, line 267) 아래에 추가:
```css
.sb-item__badge--warn { background: var(--warn-100, oklch(0.96 0.06 80)); color: var(--warn-600, oklch(0.62 0.14 70)); }
.sb-item.active .sb-item__badge--warn { background: var(--warn-100, oklch(0.96 0.06 80)); color: var(--warn-600, oklch(0.62 0.14 70)); }
```
- `--warn-100/600`은 `:root`·다크모드 모두 정의됨(styles.css:31–33, 84). fallback 동봉(투명 배경 회귀 방지).

## 5. 테스트 설계 (tests/data-service.test.js)

`collectInkShortage` 단위 테스트 (코어만 — 픽스처 단순):
1. 부족 없음(weeklyNeed ≥ 0 또는 null만) → `show:false, shortageCount:0`
2. 부족 1건 → `shortageCount:1`, items에 해당 잉크
3. 부족 다건 → `weeklyNeed` 오름차순(가장 부족 먼저) 정렬 확인
4. `weeklyNeed:null`(현재고 미입력) → 제외
5. tooltip: 3건 초과 시 '외' 접미사 + 상위 3개 이름 노출

픽스처 예:
```js
const merged = [{name:'A'},{name:'B'},{name:'C'},{name:'D'}];
const cb = new Map([
  ['A', new Map([['월',{weeklyNeed:-5}]])],
  ['B', new Map([['월',{weeklyNeed:2}]])],
  ['C', new Map([['월',{weeklyNeed:null}]])],
  ['D', new Map([['월',{weeklyNeed:-1}]])],
]);
// → shortageCount 2, items[0].ink==='A'(-5), items[1].ink==='D'(-1)
```

## 6. 영향 범위 / 회귀

| 파일 | 변경 | 회귀 위험 |
|------|------|-----------|
| data-service.js | 함수 2개 + export 2개 | 신규 추가만 — 기존 0 |
| app.jsx | useMemo 1 + bell 블록 교체 + 사이드바 1줄 + APP_REV | bell 마스터 동작 보존 필요 |
| styles.css | `.sb-item__badge--warn` 2줄 | 신규 클래스 — 기존 0 |
| index.html | 캐시 버전 +1 | 없음 |
| tests | 케이스 +5 | 없음 |

## 7. 구현 순서 (Do)

1. data-service.js: `collectInkShortage` + `buildInkShortageBadge` + export
2. tests: `collectInkShortage` 5케이스 → `node --test` GREEN 확인
3. styles.css: `.sb-item__badge--warn`
4. app.jsx: useMemo + bell 통합 + 사이드바 배지 + APP_REV 55
5. index.html: 캐시 버전 +1
6. QA(Playwright): 부족 주입 → 배지·bell·라우팅·수치 일치 검증
