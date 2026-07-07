# Gap 분석 — 페이지 순수 로직 → data-service.js 추출 (R3-1순위)

- 기능 키: `data-service-추출`
- 분석일: 2026-06-01
- 선행: [01-plan.md](./01-plan.md) · [02-design.md](./02-design.md)

## 1. Design DoD vs 구현 대조

| DoD 항목 | 상태 | 근거 |
|----------|------|------|
| 3개 페이지 순수 함수 → `DataService.*` 노출 | ✅ | data-service.js에 16함수 export (ink-plan 9·review 6·inventory 1) |
| 페이지가 alias로만 순수 로직 호출 (D3) | ✅ | inline 정의 0건, `const fn = DataService.fn` 16줄로 교체 |
| 공유 normalize 4종 단일화 (D1·D2) | ✅ | ui.jsx가 `normalizeProductName/Brand·dayFromDate·inkOfAssignment`를 위임 |
| 단위 테스트 추가 (목표 25+) | ✅ | `tests/extracted-logic.test.js` 신규 25 케이스 |
| 기존 테스트 100% 통과 | ✅ | `npm test` 95 pass / 0 fail (기존 70 + 신규 25) |
| 페이지 동작 회귀 0 | ✅ | 추출본 vs 원본 본문 diff = 주석/내부헬퍼명만 상이, 로직 동일 검증 |
| 데이터 모델 변경 없음 | ✅ | 순수 이동 리팩토링, 스키마 무변경 |

## 2. 정량 지표

| 파일 | 이전 | 이후 | 감소 |
|------|------|------|------|
| pages/ink-plan.jsx | 857 | 659 | **-198** |
| pages/review.jsx | 960 | 770 | **-190** |
| pages/inventory.jsx | 968 | 948 | -20 |
| JS 단위 테스트 | 70 | **95** | +25 |

## 3. 회귀 위험 검증

- **로직 동일성**: 3파일 모두 git HEAD 원본과 data-service 추출본을 들여쓰기/주석 정규화 후 diff → 차이는 (a) 주석 문구, (b) data-service가 내부 헬퍼(`dayOf`·`fmtMd`·`daysBetween`·`machineNoOf`)를 self-contained화한 것뿐. 실행 로직 100% 동일.
- **로드 순서**: index.html에서 `data-service.js → ui.jsx → pages` 순서 확인 → 페이지 module-scope `const X = DataService.X` 평가 시점에 글로벌 보장.
- **중복 정의**: data-service.js 내 16함수 각 1회만 정의(전수 grep) → 중복 없음.
- **호출부 무변경**: 컴포넌트 내부의 `buildProductLookup(...)` 등 호출은 alias 덕분에 무변경 동작.

## 4. Match Rate

**100%** — 모든 DoD 충족, 측정 가능한 목표(테스트 25+·기존 통과·회귀 0) 달성.

## 5. 잔여(비목표, 차기 사이클)

- UI 컴포넌트(InkPlanRow·ReviewTable 등) 분리 — DOM 의존, 별도 사이클
- focus 이동 헬퍼(`focusNextCellInColumn`·`invFocusNextInCol`) — DOM 의존, 페이지 잔류
- R3-2순위(DAYS/SHIFTS/FLOORS 상수 단일화), R3-3순위(normInk 통일) — 후속 PDCA
