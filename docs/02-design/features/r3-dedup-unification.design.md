# Design — R3 중복 제거·단일화 (r3-dedup-unification)

> PDCA Design · 2026-06-01 · 선행 [01-plan](../../01-plan/features/r3-dedup-unification.plan.md)

## D1. 아키텍처 결정: data-service.js를 단일 출처로

근거: data-service.js는 로드 순서상 **최초**(index.html: data-service → ui → pages)이며
이미 순수 도메인 계층. 요일/교대/잉크정규화는 모두 도메인 상수·도메인 함수 →
여기 두면 (a) 페이지·ui 어디서든 글로벌로 참조 가능, (b) data-service 내부 중복도 동시 제거.

노출 방식: 기존 `DataService.normalizeProductName` 위임 패턴과 동일하게
`DataService.WEEKDAYS` 등으로 export. ui.jsx의 기존 글로벌 `WEEKDAYS`/`WEEKDAYS_PLUS`는
**값 재정의 → DataService 참조**로 바꿔 기존 호출부(review.jsx 등) 무변경 호환.

## D2. R3-2 상수 설계 (data-service.js)

```js
// ── 도메인 상수 (요일/교대) — 단일 출처 ──────────────────
var WEEKDAYS      = Object.freeze(['월','화','수','목','금','토','일']);          // 주간 7요일
var WEEKDAYS_PLUS = Object.freeze(['월','화','수','목','금','토','일','차주월']); // +차주월(8)
var DAY_BY_IDX    = Object.freeze(['일','월','화','수','목','금','토']);          // Date.getDay() 인덱스순
var SHIFTS        = Object.freeze(['day','night']);                               // 주/야 교대
```

- export 추가: `WEEKDAYS, WEEKDAYS_PLUS, DAY_BY_IDX, SHIFTS`
- 내부 교체:
  - `aggregateChemicalRequest`: `allDays` → `WEEKDAYS_PLUS`, `['day','night']` → `SHIFTS`
  - `dayFromDate`(L624): `['일'..'토']` → `DAY_BY_IDX`
  - L962 `DAY_BY_IDX` 지역정의 → 상수 참조
- **freeze 안전성**: 모든 사용처 read-only(map/indexOf/filter/Set). 변형 필요 지점(chemicals
  `customDays` state, `[...WEEK]`)은 이미 spread 복사 → 그대로 유지.

### 호출부 교체 매핑

| 파일 | before | after |
|------|--------|-------|
| ui.jsx:99-100 | `const WEEKDAYS=[…]` (리터럴) | `const WEEKDAYS = DataService.WEEKDAYS` |
| ui.jsx getWeekInfo | 지역 `DAY_BY_IDX`,`days` | `DataService.DAY_BY_IDX`, `WEEKDAYS` |
| ink-plan.jsx:9 | `INKPLAN_DAYS=[…]` | `const INKPLAN_DAYS = WEEKDAYS` (글로벌 참조) |
| ink-add.jsx:10 | `WEEK=[…]` | `const WEEK = WEEKDAYS` |
| chemicals.jsx:7-8 | `WEEK`,`ALL_DAYS` 리터럴 | `WEEKDAYS`, `WEEKDAYS_PLUS` 참조 (spread 사용처 유지) |
| injection.jsx:14,192 | `[…'차주월']`, `['day','night']` | `WEEKDAYS_PLUS`, `SHIFTS` |
| inventory.jsx:47 | `['일'..'토']` | `DataService.DAY_BY_IDX` |
| test-inks.jsx:70 | `['월'..'일']` | `WEEKDAYS` |
| machines.jsx:112 | `['월'..'일']` | `WEEKDAYS` |

## D3. R3-3 normInk 설계 (data-service.js)

```js
// 잉크명 식별 정규화 (마스터 비교·dedup용): null-safe + trim + lowercase
function normalizeInkName(name) {
  return String(name == null ? '' : name).trim().toLowerCase();
}
```

- export 추가: `normalizeInkName`
- 내부 위임: `buildInkMaster`의 `add`, `isInkInMaster` → `normalizeInkName` 호출
- 페이지 위임:
  - `products.jsx:370-371` 본체 → `DataService.normalizeInkName` 래퍼(기존 호출부 무변경)
  - `review.jsx:185,190,326` 인라인 `String(v||'').trim().toLowerCase()` → `DataService.normalizeInkName`
- 동작 동치: `x||''` → `x==null?'':x`. 잉크명은 항상 문자열이므로 유효 입력 전부 동일 결과
  (차이는 `0`·`false` 등 비문자 falsy뿐 — 잉크명에 부재).

## D4. 테스트 설계 (회귀 방지)

`tests/data-service.test.js`에 추가:
1. 상수 정합성: `WEEKDAYS.length===7`, `WEEKDAYS_PLUS`가 `WEEKDAYS`+`'차주월'`,
   `DAY_BY_IDX[0]==='일'`, `SHIFTS` 순서, `Object.isFrozen` 4종 true.
2. `normalizeInkName`: 공백/대소문자/ null·undefined / 좌우공백 정규화.
3. 통합 동치: `isInkInMaster`가 `normalizeInkName` 기준으로 일관 매칭(기존 케이스 유지).

기존 95 테스트는 그대로 통과해야 함(상수/정규화 결과 불변).

## D5. 검증 절차

1. `npm test` → JS 95+ GREEN
2. `npm run test:py` → 19 GREEN
3. grep로 잔여 인라인 중복 0건 확인(요일 리터럴·`['day','night']`·잉크 인라인 정규화)
4. gap-detector로 DoD 대조 → Match Rate ≥ 90%
