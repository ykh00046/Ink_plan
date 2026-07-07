# Design — 페이지 순수 로직 → data-service.js 추출

- 기능 키: `data-service-추출`
- 작성일: 2026-05-31
- 선행: [01-plan.md](./01-plan.md)

## 1. 아키텍처 결정

### D1. 의존성 재배선 (data-service 내부화)
이전 대상 함수가 참조하던 외부 글로벌을 data-service **내부 함수**로 치환한다.

| 원본 참조 (페이지/ui) | 이전 후 (data-service 내부) |
|----------------------|----------------------------|
| `normalizeProductName` (ui.jsx) | data-service 내부 함수 |
| `normalizeBrand` (ui.jsx) | data-service 내부 함수 |
| `dayFromDate` (ui.jsx) | data-service 내부 함수 |
| `inkOfAssignment` (ui.jsx) | data-service 내부 함수 |
| `parseDateLocal` | 이미 data-service 내부 (무변경) |
| `DataService.machineNoOf` (review) | 내부 `machineNoOf` 직접 참조 |

### D2. delegate 전략 (ui.jsx 하위호환)
`ui.jsx`의 글로벌 헬퍼는 **삭제하지 않고** data-service로 위임한다. 타 페이지(products·ocr-import 등)의 기존 `normalizeProductName(...)` 호출을 무변경 유지.

```js
// ui.jsx — 본문을 위임으로 교체
function normalizeProductName(name) { return DataService.normalizeProductName(name); }
function normalizeBrand(brand)       { return DataService.normalizeBrand(brand); }
function dayFromDate(iso, fb = '월') { return DataService.dayFromDate(iso, fb); }
function inkOfAssignment(a)          { return DataService.inkOfAssignment(a); }
```
로드 순서상(data-service→ui) 안전.

### D3. alias 전략 (페이지 최소 diff)
페이지의 모듈 스코프 함수 정의를 **DataService alias 1줄**로 교체. 컴포넌트 내부의 `buildProductLookup(...)` 등 호출부는 그대로 동작.

```js
// pages/ink-plan.jsx — 정의 블록(29~236)을 alias로 교체
const buildProductLookup       = DataService.buildProductLookup;
const resolveProductIn         = DataService.resolveProductIn;
const buildProductsUsingInk    = DataService.buildProductsUsingInk;
const buildDemandByInkDay      = DataService.buildDemandByInkDay;
const buildInkToMachine        = DataService.buildInkToMachine;
const buildInventoryByInkDay   = DataService.buildInventoryByInkDay;
const mergeInkPlanAndTestInks  = DataService.mergeInkPlanAndTestInks;
const computeInkMetrics        = DataService.computeInkMetrics;
const buildAutoAssignCandidates= DataService.buildAutoAssignCandidates;
```
review/inventory 동일 패턴.

## 2. 함수 시그니처 (불변 — 순수 이동)

| 함수 | 시그니처 | 반환 |
|------|---------|------|
| normalizeProductName | (name) | string (NFC·대문자·특수문자제거) |
| normalizeBrand | (brand) | string (슬래시 앞·대문자) |
| dayFromDate | (iso, fallback='월') | '월'~'일' |
| inkOfAssignment | (a) | string |
| buildProductLookup | (products) | {exact:Map, normalized:Map} |
| resolveProductIn | (lookup, name) | product\|null |
| buildProductsUsingInk | (injection, lookup) | Map<ink, name[]> |
| buildDemandByInkDay | (injection, lookup) | Map<ink, Map<day,count>> |
| buildInkToMachine | (assignments) | Map<ink, machine> |
| buildInventoryByInkDay | (inventory, dates) | Map<ink, Map<day,sum>> |
| mergeInkPlanAndTestInks | (inkPlan, testInks, days) | merged[] |
| computeInkMetrics | (merged, demand, inv, days) | Map<name, Map<day,metrics>> |
| buildAutoAssignCandidates | (inkPlan, testInks, today, days, computed) | candidate[] |
| matchOcrRow | (r, masterIndex) | {status,...} |
| buildReviewRows | (ocrResult, masterIndex) | row[] |
| buildProductGroups | (rows) | group[] |
| mapOcrRowsInGroup | (ocrResult, rowKeys, field, value) | ocrResult |
| changeMachineInGroup | (ocrResult, rowKeys, machineNo) | {next, keyMap} |
| applyOcrToInjection | (data, ocrResult, decisions) | {nextData, ...}\|{error} |
| inkLifeInfo | (lot, baseDate) | {text, tone, title} |

## 3. 테스트 설계 (신규)

`tests/data-service.test.js`에 추가:
- normalize 헬퍼 4종 — 정규화 규칙·엣지(null/공백/슬래시)
- buildProductLookup/resolveProductIn — exact·normalized 폴백
- buildDemandByInkDay — 셀 채움 카운트, null 제품 skip
- computeInkMetrics — stock 우선순위(수동>inv>carry), availableDays·weeklyNeed·carry
- mergeInkPlanAndTestInks — 정식 우선, testOnly 분리
- buildAutoAssignCandidates — 음수 need만, 잠긴 셀 제외
- matchOcrRow — exact/brand-mismatch/none/TEST
- buildProductGroups — 그룹 승격, TEST 분리
- applyOcrToInjection — 머지·명일주간·no-request-day·floor 매핑
- inkLifeInfo — 남음/지남/재라벨 tone 경계

## 4. 변경 파일
- `data-service.js` (함수 추가 + return export)
- `ui.jsx` (헬퍼 4종 delegate화)
- `pages/ink-plan.jsx` · `pages/review.jsx` · `pages/inventory.jsx` (alias화)
- `tests/data-service.test.js` (테스트 추가)
