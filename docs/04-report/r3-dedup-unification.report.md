# Report — R3 중복 제거·단일화 (r3-dedup-unification)

> PDCA 완료 보고 · 2026-06-01 · Plan→Design→Do→Check→Act 1사이클 완료

## 1. 요약

bkit R3 권고 2·3순위(매직 문자열 단일화 / normInk 통일)를 **동작 변경 0의 순수 정리**로 완료.
흩어져 있던 요일·교대 배열과 잉크명 정규화를 `data-service.js` 단일 출처로 모았다.

| 지표 | Before | After |
|------|--------|-------|
| 요일 매직 배열 인라인 | 13곳 | **1곳** |
| 교대 배열 인라인 | 3곳 | **1곳(SHIFTS)** |
| 잉크 정규화 인라인 | 9곳 | **1곳(normalizeInkName)** |
| JS 테스트 | 95 | **99** |
| Python 테스트 | 19 | 19 |

전체 GREEN, 기존 테스트 회귀 0, 브라우저 8페이지 런타임 에러 0.

## 2. 핵심 의사결정

1. **단일 출처 = data-service.js**: 로드 최초·순수 도메인 계층. 기존 normalize 위임 패턴
   그대로 확장(`DataService.WEEKDAYS` 등). ui.jsx 글로벌은 재정의→위임으로 호출부 무변경 호환.
2. **freeze 적용**: 공유 상수 in-place 변형 사고 차단. 변형 seed는 spread 복사.
3. **FLOORS는 만들지 않음**: 층은 동적 키(`Object.keys(injection)`)이므로 단일화할 매직
   문자열 부재. bkit 권고를 코드 실태에 맞춰 정정 — 없는 상수를 날조하지 않음.
4. **품목코드 정규화 보존**: 잉크명과 공식만 동일·도메인 상이 → normInk로 강제 통합 안 함.

## 3. 변경 사항

### R3-2 상수 단일화
- `data-service.js`: `WEEKDAYS·WEEKDAYS_PLUS·DAY_BY_IDX·SHIFTS`(freeze) 정의·export.
  내부 `aggregateChemicalRequest`·`dayFromDate`·`applyOcrToInjection` 위임.
- `ui.jsx`: 상수 2종 위임, `getWeekInfo` 인라인 2종 제거.
- 페이지: ink-plan(INKPLAN_DAYS)·ink-add(WEEK)·chemicals(WEEK/ALL_DAYS/seed/shifts)·
  injection(days/shifts)·inventory(DAY_BY_IDX)·test-inks·machines 교체.

### R3-3 normInk 통일
- `data-service.js`: `normalizeInkName`(null-safe) 정의·export, buildInkMaster·isInkInMaster 위임.
- `products.jsx`·`review.jsx`·`machines.jsx`(잉크명 한정) 인라인 정규화 → 위임.

### 테스트
- `tests/data-service.test.js` +4: 상수 정합·freeze, dayFromDate 일관, normalizeInkName, isInkInMaster 일관.

## 4. 검증
```
JS : # tests 99 / # pass 99 / # fail 0
PY : Ran 19 tests ... OK
Browser smoke : 편집 8페이지 로드, JS 런타임 에러 0 (콘솔 에러는 정적서버 API 404뿐)
잔여 중복 grep : 0건 (남은 것은 단일 출처 본체·범용 검색·품목코드뿐)
```

## 5. 후속 제안 (범위 외)
- UI 컴포넌트(InkPlanRow·ReviewTable) 분리 — DOM 의존, 별도 사이클
- focus 이동 헬퍼 페이지 잔류분 — DOM 의존
- 범용 검색 정규화(history·products needle) 통일은 검색 UX 사이클에서 함께 검토
