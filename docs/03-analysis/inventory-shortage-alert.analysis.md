# Gap Analysis — 재고 부족 예상 전역 알림 (inventory-shortage-alert)

> PDCA Check · 2026-06-08 · Design: [[inventory-shortage-alert]] · **Match Rate 100%**

## 1. 설계 ↔ 구현 매칭

| # | 설계 항목 | 구현 위치 | 상태 |
|---|-----------|-----------|------|
| 1 | `collectInkShortage(merged, computedByInk)` 순수 코어 | data-service.js (buildMasterHealthBadge 다음) | ✅ |
| 2 | weeklyNeed<0 수집 + 오름차순 정렬 + null 제외 | 동 함수 내부 | ✅ |
| 3 | tooltip(상위 3 + '외') | 동 함수 | ✅ |
| 4 | `buildInkShortageBadge(data, dates)` 어댑터 (동일 함수 합성) | data-service.js | ✅ |
| 5 | export 2개 | data-service.js export 블록 | ✅ |
| 6 | app.jsx `inkShortage` useMemo (data null-safe) | app.jsx (masterHealth 다음) | ✅ |
| 7 | bell 통합: count 합산 / tip 결합 / tone(bad·warn) / 라우팅(data-quality·ink-plan) | app.jsx (ctx 다음 + 버튼 블록) | ✅ |
| 8 | 사이드바 ink-plan 주황 배지 | app.jsx (data-quality 배지 다음) | ✅ |
| 9 | `APP_REV` 55 | app.jsx | ✅ |
| 10 | `.sb-item__badge--warn` (fallback 동봉) | styles.css | ✅ |
| 11 | index.html 캐시 버전 bump | data-service.js/app.jsx/styles.css ?v=58 | ✅ |
| 12 | `collectInkShortage` 단위 테스트 5케이스 | tests/data-service.test.js | ✅ |

**Match Rate = 12/12 = 100%**

## 2. 검증 결과

| 검증 | 결과 |
|------|------|
| 단위 테스트 (3파일) | **91 GREEN / 0 FAIL** (data-service 49 = 기존 44 + 신규 5, ui 21, date 21) |
| 통합 스모크 (Node) | 부족 1건 정확 식별(잉크X, weeklyNeed −2), 충분/미입력 제외, clean=미표시 |
| 브라우저 런타임 (Playwright) | JSX 컴파일 **0 errors**, `collectInkShortage`·`buildInkShortageBadge` 함수 노출 확인, 부족 시나리오 정확 |
| bell 회귀 | 현 데이터의 마스터 결함 동작(빨강 "1" → 데이터 점검 필요) **기존대로 보존** |

## 3. 설계 일탈 / 보완

| 항목 | 내용 |
|------|------|
| 캐시 버전 | 설계는 "+1"이었으나, 작업 중 linter가 data-service/ui/inventory를 v=57로 선반영 → 수정 3파일(data-service/app/styles)을 **v=58로 통일**해 캐시 무효화 확실화. 설계 의도(무효화)와 일치 |
| 미관측 시나리오 | 마스터 결함 + 재고 부족 **동시 발생 시 bell 합산**은 실제 UI에서 미관측(현 데이터에 재고 부족 0). 단 각 소스 + 합산 산술이 단순·검증돼 위험 낮음 |

## 4. 결론

설계 100% 구현, 회귀 0, 전 계층(단위·통합·브라우저) 검증 통과. **Report 단계 진행 가능.**
