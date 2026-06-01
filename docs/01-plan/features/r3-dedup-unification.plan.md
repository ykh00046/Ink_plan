# Plan — R3 중복 제거·단일화 (r3-dedup-unification)

> PDCA Plan · 2026-06-01 · 선행 R3-1(test-coverage-hardening) 완료 후속

## 1. 배경

bkit R3 개선 권고 중 2·3순위. R3-1(테스트 공백 보강)은 이전 세션에서 완료(JS 95 / PY 19 GREEN).
이번 사이클은 **동작 변경 0의 순수 정리 리팩토링**으로, 흩어진 매직 문자열과
중복 정규화 로직을 단일 출처(Single Source of Truth)로 모은다.

## 2. 목표 (R3-2 + R3-3)

### R3-2 — 요일/교대 매직 문자열 단일화
현재 동일 배열이 9개 파일에 인라인 중복:

| 상수 의미 | 리터럴 | 중복 위치 |
|-----------|--------|-----------|
| 주간 7요일 | `['월'..'일']` | ui.jsx(WEEKDAYS), ink-plan(INKPLAN_DAYS), ink-add(WEEK), chemicals(WEEK), test-inks, machines |
| 8요일(+차주월) | `[..'일','차주월']` | ui.jsx(WEEKDAYS_PLUS), injection, chemicals(ALL_DAYS), data-service(allDays) |
| getDay() 인덱스순 | `['일','월'..'토']` | data-service(×2), ui.jsx(getWeekInfo·×2), inventory |
| 교대 | `['day','night']` | data-service, chemicals, injection |

→ **data-service.js를 단일 출처**로 삼아 상수 4종 노출, 나머지는 참조로 교체.

### R3-3 — 잉크명 정규화(normInk) 통일
`String(x).trim().toLowerCase()` 형태의 잉크명 식별 정규화가 4곳 중복:
- `pages/products.jsx` `normalizeInkName` (정본 후보)
- `data-service.js` `buildInkMaster` / `isInkInMaster` 인라인
- `pages/review.jsx` 인라인(×3)

→ `DataService.normalizeInkName` 단일 정의, 내부·페이지 모두 위임.

## 3. 비목표 (스코프 제외)

- **FLOORS 상수화**: 호기 층은 정적 리스트가 아니라 `Object.keys(data.injection)` 동적 키.
  단일화할 매직 문자열이 실재하지 않음 → 상수 날조하지 않음 (권고를 코드 실태로 정정).
- 머신코드 정규화(`machines.jsx`의 code `.trim().toLowerCase()`): 잉크명과 우연히 동일 공식이나
  도메인이 다름 → normInk로 강제 통합하지 않음.
- UI 컴포넌트 분리, DOM 의존 로직 — 별도 사이클.

## 4. Definition of Done

- [ ] data-service.js에 `WEEKDAYS·WEEKDAYS_PLUS·DAY_BY_IDX·SHIFTS` 상수 단일 정의 + export (Object.freeze)
- [ ] data-service.js에 `normalizeInkName` 정의 + export, 내부 buildInkMaster·isInkInMaster 위임
- [ ] ui.jsx WEEKDAYS·WEEKDAYS_PLUS·getWeekInfo 인라인 → 상수 참조
- [ ] 페이지(ink-plan·ink-add·chemicals·injection·inventory·test-inks·machines·products·review) 중복 제거
- [ ] 동작 보존: 기존 테스트 100% 통과(JS 95 / PY 19), 회귀 0
- [ ] 상수 단일화·normInk 회귀 방지 단위 테스트 추가
- [ ] 데이터 모델·스키마 변경 없음

## 5. 리스크 & 완화

| 리스크 | 완화 |
|--------|------|
| frozen 배열을 in-place 변형하는 호출부 | 변형 지점은 spread 복사(`[...WEEKDAYS]`) 유지/적용. 전 사용처 read-only 확인 |
| 로드 순서(글로벌 미평가) | index.html: data-service → ui → pages 순서로 module-scope 평가 시 글로벌 보장(R3-1과 동일 검증) |
| normInc 미세 동작차(`x||''` vs `x==null`) | null-safe 버전으로 통일 — 유효 잉크명(문자열)에 한해 동치, 문서화 |
