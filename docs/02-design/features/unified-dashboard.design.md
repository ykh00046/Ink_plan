# Design — 통합 대시보드 (unified-dashboard)

> PDCA Design · 2026-06-08 · [[unified-dashboard]] Plan 기반 · 단일 출처 = 기존 어댑터 합성

## 1. 아키텍처 개요

```
data ──▶ buildDashboardSummary(data, dates, opts)   [data-service.js · 순수]
           ├─ lintMasters(data,{normalize})        → master  {errorCount, warnCount, show}
           ├─ buildInkShortageBadge(data, dates)    → shortage{shortageCount, items[], show}
           ├─ data.products/inks/chemicals length   → masters {products, inks, chemicals}
           └─ dates/today                            → week    {today, dates[], dayCount}
                         │
                         ▼  단일 모델 { master, shortage, masters, week }
            DashboardPage(ctx)  [pages/dashboard.jsx · window.DashboardPage]
                         │  카드 그리드 렌더 + onClick=ctx.setView(targetId)
                         ▼
            app.jsx  view==='dashboard' && <DashboardPage ctx={ctx}/>  (기본 진입)
```

핵심 원칙: **계산은 전부 기존 어댑터 재사용**. `buildDashboardSummary`는 합성·정규화만 한다(새 임계값 0개).

## 2. data-service.js — `buildDashboardSummary`

### 시그니처
```js
// 전역 대시보드 요약 모델. 기존 어댑터(lintMasters·buildInkShortageBadge) 합성.
// data===null 안전 → 모든 카운트 0, show=false. 새 부족 기준 발명 금지(단일 출처 재사용).
function buildDashboardSummary(data, dates, opts) {
  opts = opts || {};
  const normalize = opts.normalize; // products.jsx와 동일 normalizeProductName 주입(주입 없으면 lintMasters 기본)
  // master
  const lint = lintMasters(data, normalize ? { normalize } : undefined);
  const master = {
    errorCount: lint.errorCount || 0,
    warnCount:  lint.warnCount  || 0,
    show:       !!lint.show,
    tooltip:    lint.tooltip || '마스터 정합성 정상',
    tone:       (lint.errorCount > 0) ? 'bad' : (lint.warnCount > 0 ? 'warn' : 'ok'),
  };
  // shortage (재고 부족 임박)
  const sb = buildInkShortageBadge(data, dates);
  const shortage = {
    count:    sb.shortageCount || 0,
    items:    (sb.items || []).slice(0, 5), // 가장 부족한 상위 5
    show:     !!sb.show,
    tooltip:  sb.tooltip || '재고 정상',
    tone:     (sb.shortageCount > 0) ? 'warn' : 'ok',
  };
  // masters 규모 (참고용, 비경보)
  const masters = {
    products:  Array.isArray(data && data.products)  ? data.products.length  : 0,
    inks:      Array.isArray(data && data.inks)      ? data.inks.length      : 0,
    chemicals: Array.isArray(data && data.chemicals) ? data.chemicals.length : 0,
  };
  // week
  const ds = Array.isArray(dates) ? dates : [];
  const week = { today: (opts.today || null), dates: ds, dayCount: ds.length };
  return { master, shortage, masters, week };
}
```

### 반환 모델
| 키 | 필드 | 출처(단일) |
|---|---|---|
| `master` | errorCount, warnCount, show, tooltip, tone | `lintMasters` |
| `shortage` | count, items[{ink,weeklyNeed}], show, tooltip, tone | `buildInkShortageBadge` |
| `masters` | products, inks, chemicals (length) | `data.*` |
| `week` | today, dates[], dayCount | `opts.today`/`dates` |

- exports에 `buildDashboardSummary` 추가 (line ~1238 인근, computeInkMetrics 옆).
- `tone` 3값: `'bad'|'warn'|'ok'` → 페이지가 색 클래스로 매핑(로직 페이지 비누출).

## 3. pages/dashboard.jsx — `DashboardPage`

```
function DashboardPage({ ctx }) {
  const { data, dates, today, setView } = ctx;
  const sum = React.useMemo(
    () => DataService.buildDashboardSummary(data, dates, { today, normalize: window.normalizeProductName }),
    [data, dates, today]
  );
  // 카드 4종 — Card({title, tone, value, sub, onClick})
}
window.DashboardPage = DashboardPage;
```

### 카드 4종
| 카드 | value | sub | tone | onClick → setView |
|---|---|---|---|---|
| 마스터 정합성 | error N건 (없으면 "정상") | warn M건 / tooltip | master.tone | `data-quality` |
| 재고 부족 임박 | 부족 K건 (없으면 "정상") | 상위 잉크명 나열(items) | shortage.tone | `ink-plan` |
| 이번 주 일정 | 오늘 요일·날짜 | 영업일 dayCount일 (dates 나열) | ok | `injection` |
| 마스터 규모 | 제품 P · 잉크 I · 약품 C | "마스터 관리" | ok | `products` |

- `normalizeProductName`은 전역(products.jsx 등에서 노출). 미존재 시 lintMasters 기본 정규화로 graceful.
- 카드는 버튼 역할(키보드 접근: `<button>` 또는 role+tabIndex). 클릭/Enter 모두 setView.
- data===null → sum이 0/정상 모델 → "데이터 로딩 중" 대신 안전한 0 표시(깜빡임 최소).

## 4. app.jsx 변경점

1. **NAV 최상단 그룹 추가**:
```js
{ group: '', items: [ { id: 'dashboard', label: '대시보드', icon: 'sparkle' } ] },
```
   (또는 '일일 작업' 그룹 첫 항목으로 삽입. group '' 헤더 미표시 처리 확인 — 없으면 '일일 작업'에 편입.)
2. **기본 view**: `useState('inventory')` → `useState('dashboard')` (line 93).
3. **렌더 분기 추가**: `{view === 'dashboard' && <DashboardPage ctx={ctx} />}` (line 357 블록에 추가).
4. bell/사이드바 배지 로직 **무변경**(회귀 금지).

## 5. index.html

```html
<script type="text/babel" src="pages/dashboard.jsx?v=1"></script>
```
(다른 페이지 script 옆, line 21~32 블록.)

## 6. styles.css

```css
.dash-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; }
.dash-card { /* 기존 카드 표면 토큰 재사용 */ border:1px solid var(--line,#e5e7eb);
             border-radius:12px; padding:18px; text-align:left; cursor:pointer; background:var(--surface,#fff); }
.dash-card:hover { box-shadow:0 2px 8px rgba(0,0,0,.08); }
.dash-card--bad  { border-color:var(--bad-600,#dc2626);  }
.dash-card--warn { border-color:var(--warn-600,#d97706); }
.dash-card__value{ font-size:1.6rem; font-weight:700; }
.dash-card--bad  .dash-card__value{ color:var(--bad-600,#dc2626); }
.dash-card--warn .dash-card__value{ color:var(--warn-600,#d97706); }
```
- 토큰 fallback **필수**([[unmapped-products-badge]] QA 교훈). 기존 변수명은 styles.css 확인 후 정렬.

## 7. 테스트 (tests/data-service.test.js)

| # | 케이스 | 기대 |
|---|---|---|
| 1 | `buildDashboardSummary(null, [])` | 모든 카운트 0, show=false, tone='ok', throw 없음 |
| 2 | 깨끗한 data | master.tone='ok', shortage.count=0, masters 카운트 정확 |
| 3 | 마스터 error 주입 | master.errorCount>0, tone='bad' |
| 4 | `weeklyNeed<0` 잉크 주입 | shortage.count == ink-plan 빨강 수, tone='warn', items 상위 정렬 |
| 5 | shortage.items | 최대 5개로 제한(slice), 가장 부족한 순 |
| 6 | masters 카운트 | data.products/inks/chemicals length와 일치 |

- 기존 `buildInkShortageBadge`/`lintMasters` 테스트와 **수치 교차 검증**(동일 fixture로 카운트 일치 확인).

## 8. 구현 순서

1. data-service.js: `buildDashboardSummary` + exports
2. tests/data-service.test.js: 케이스 6종 추가 → `node --test` GREEN
3. pages/dashboard.jsx 신설
4. index.html script 등록
5. app.jsx: NAV + 기본 view + 렌더 분기
6. styles.css: `.dash-*`
7. 캐시 버전 bump (필요 jsx) + QA(서버 기동 후 화면 확인)

## 9. 비고
- 서버/스토리지/마이그레이션 **무변경** — 순수 읽기 전용 합성.
- 신규 데이터 모델 0, 신규 임계값 0 → 회귀 표면 최소.
