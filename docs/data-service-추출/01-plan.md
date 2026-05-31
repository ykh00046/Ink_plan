# Plan — 페이지 순수 로직 → data-service.js 추출

- 기능 키: `data-service-추출`
- 작성일: 2026-05-31
- 레벨: Dynamic
- 선행: R2(약품요청서·마스터-정합성·잉크-cascade) 아카이브 완료, code-review 2026-05-29 SHIP

## 1. 배경 / 문제

종합 분석(이전 세션)에서 **코드 품질 개선점 ①: 거대 페이지 파일에 비즈니스 로직 혼재**가 최우선으로 식별됨.

| 파일 | 줄 수 | 모듈 스코프 순수 함수 |
|------|------|----------------------|
| `pages/ink-plan.jsx` | 857 | 9개 (productLookup·demand·inventory·metrics 엔진) |
| `pages/review.jsx` | 960 | 6개 (OCR 매칭·그룹화·사출 머지) |
| `pages/inventory.jsx` | 968 | 1개 (LOT 유효기간 계산) |

**핵심 발견**: 이 함수들은 이미 잘 분리된 순수 함수다. 하지만
1. **페이지 파일 안에 갇혀 있어** 재사용·발견성이 낮고,
2. **단위 테스트가 전혀 없다** (data-service.js의 25개 export는 잘 테스트됨과 대조).

또한 이들이 의존하는 공유 normalize 헬퍼(`normalizeProductName`·`normalizeBrand`·`dayFromDate`·`inkOfAssignment`)는 `ui.jsx`에 흩어져 있어 이전 분석의 **"정규화 함수 중복"** 지적과도 연결됨.

## 2. 목표 (측정 가능)

- [ ] 3개 페이지의 순수 파생 함수를 `data-service.js`로 이전, `DataService.*`로 노출
- [ ] 공유 normalize 헬퍼 4종을 data-service로 단일화 (ui.jsx는 위임)
- [ ] 이전 함수에 대한 단위 테스트 추가 (목표: 신규 25+ 케이스)
- [ ] 기존 테스트 100% 통과 유지 (JS 60 → 85+), 페이지 동작 회귀 0

## 3. 비목표 (이번 범위 제외)

- UI 컴포넌트(InkPlanRow, ReviewTable 등) 분리 — DOM 의존, 별도 사이클
- focus 이동 헬퍼(`focusNextCellInColumn`, `invFocusNextInCol`) — DOM 의존, 페이지 잔류
- 인쇄 CSS, 상태 핸들러(handleAddNew 등) — React state 결합, 잔류
- 데이터 모델 변경 없음 (순수 이동 리팩토링)

## 4. 대상 함수 (20개)

**Group 1 — ink-plan 엔진 (9)**: buildProductLookup, resolveProductIn, buildProductsUsingInk, buildDemandByInkDay, buildInkToMachine, buildInventoryByInkDay, mergeInkPlanAndTestInks, computeInkMetrics, buildAutoAssignCandidates

**Group 2 — review/OCR (6)**: matchOcrRow, buildReviewRows, buildProductGroups, mapOcrRowsInGroup, changeMachineInGroup, applyOcrToInjection

**Group 3 — 공유 normalize 헬퍼 (4)**: normalizeProductName, normalizeBrand, dayFromDate, inkOfAssignment

**Group 4 — inventory (1)**: inkLifeInfo (현 `invInkLifeInfo`)

## 5. 위험 / 완화

| 위험 | 완화 |
|------|------|
| data-service는 Node 테스트용(브라우저 globals 불가) | 의존 헬퍼(Group 3)를 함께 이전해 self-contained화 |
| 페이지 내부 호출부 다수 변경 → 회귀 | **alias 기법**: 페이지에서 `const fn = DataService.fn` 1줄로 교체, 나머지 호출부 무변경 |
| 글로벌 `normalizeProductName` 등 타 페이지서도 사용 | ui.jsx에서 **delegate**로 남겨 기존 글로벌 이름 유지 |
| 로드 순서 의존 | 확인됨: `data-service.js → ui.jsx → pages` (index.html) |

## 6. 완료 기준 (DoD)

- `node --test` 전체 통과 + 신규 테스트 포함
- 3개 페이지가 `DataService.*` 또는 alias로만 순수 로직 호출
- ui.jsx normalize 헬퍼가 data-service 위임
- Gap 분석 ≥ 90%, 완료 보고서 작성
