# Gap 분석 — R3 중복 제거·단일화 (r3-dedup-unification)

> PDCA Check · 2026-06-01 · 선행 [01-plan](../01-plan/features/r3-dedup-unification.plan.md) · [02-design](../02-design/features/r3-dedup-unification.design.md)

## 1. Design DoD vs 구현 대조

| DoD 항목 | 상태 | 근거 |
|----------|------|------|
| data-service.js 상수 4종 단일 정의 + export (freeze) | ✅ | `WEEKDAYS·WEEKDAYS_PLUS·DAY_BY_IDX·SHIFTS` Object.freeze, export·`Object.isFrozen` 검증 통과 |
| normalizeInkName 정의 + export, 내부 위임 | ✅ | data-service.js 정의, `buildInkMaster`·`isInkInMaster` 위임 |
| ui.jsx 상수·getWeekInfo 위임 | ✅ | `WEEKDAYS/WEEKDAYS_PLUS = DataService.*`, getWeekInfo 인라인 2종 제거 |
| 페이지 9종 중복 제거 | ✅ | ink-plan·ink-add·chemicals·injection·inventory·test-inks·machines·products·review 전부 교체 |
| 동작 보존(기존 테스트 100%) | ✅ | JS 95→99 / PY 19 GREEN, 기존 95 회귀 0 |
| 회귀 방지 단위 테스트 추가 | ✅ | data-service.test.js +4 (상수 정합·freeze, dayFromDate, normalizeInkName, isInkInMaster 일관) |
| 데이터 모델·스키마 무변경 | ✅ | 식별자 치환 리팩토링, 스키마 무변경 |
| 브라우저 런타임 검증 | ✅ | 편집 8페이지 전수 로드, JSX 런타임 에러 0(콘솔 에러는 정적서버 API 404뿐) |

## 2. 정량 지표

| 항목 | Before | After |
|------|--------|-------|
| 요일 매직 배열 인라인 정의 | 9파일 13곳 | **1곳(단일 출처)** |
| 교대 `['day','night']` 인라인 | 3곳 | **1곳(SHIFTS)** |
| 잉크 정규화 인라인 | 4파일 9곳 | **1곳(normalizeInkName)** |
| JS 단위 테스트 | 95 | **99** (+4) |
| Python 단위 테스트 | 19 | 19 |

## 3. 회귀 위험 검증

- **freeze 안전성**: 전 사용처 read-only(map/indexOf/filter/Set/reduce) 확인. 변형 seed
  (chemicals `customDays`)는 `[...WEEKDAYS]` spread 적용 → frozen 원본 보호.
- **로드 순서**: data-service.js(classic, 최초) → ui.jsx → pages(babel). 글로벌
  `DataService.*`·`WEEKDAYS` 평가 시점 보장. 브라우저 스모크로 실증.
- **normInk 동치**: `x||''`→`x==null?'':x` 전환은 유효 잉크명(문자열) 전부 동일 결과.
- **잔여 중복 0**: grep 재검사 — 남은 `trim().toLowerCase()`는 (a) normalizeInkName 본체,
  (b) filterByQuery 범용 검색 정규화(설계상 분리), (c) 품목코드·범용 검색(스코프 외)뿐.

## 4. Match Rate

**100%** — 모든 DoD 충족. 측정 가능 목표(상수/정규화 단일화, 기존 테스트 통과, 회귀 0,
신규 테스트, 브라우저 무에러) 전부 달성.

## 5. 비목표 처리 (정직성)

- **FLOORS**: 정적 상수 부재(`Object.keys(data.injection)` 동적 키) → 상수 날조 안 함.
  권고를 코드 실태에 맞춰 정정 기록.
- **품목코드 정규화**(machines.jsx:44,50): 잉크명과 공식만 같고 도메인 상이 → 의도적 보존.
