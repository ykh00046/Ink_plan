# Gap 분석 — 통합 대시보드 (unified-dashboard)

> PDCA Check · 2026-06-08 · Design 대비 구현 일치도 · **Match Rate 96%**

## 1. 설계 항목 대비 구현 대조

| # | Design 항목 | 구현 | 일치 |
|---|---|---|---|
| 1 | `buildDashboardSummary(data,dates,opts)` 순수 함수 | data-service.js 신설 + exports | ✅ |
| 2 | 반환 모델 `{master,shortage,masters,week}` | 동일 구조 반환 | ✅ |
| 3 | master = `lintMasters→buildMasterHealthBadge(summary)` | 동일 경로(전역 배지와 단일 출처) | ✅ |
| 4 | shortage = `buildInkShortageBadge`, items 상위 5 slice | 동일 + slice(0,5) | ✅ |
| 5 | masters = products/inkPlan/chemicals 카운트 | `countOf`(배열·객체 안전) | ✅ |
| 6 | week = today/dates/dayCount | + `todayDate`(객체 dates 대응) | ✅(개선) |
| 7 | 새 임계값·계산 0 (기존 어댑터 재사용) | 신규 임계값 0 확인 | ✅ |
| 8 | null-safe | data=null 안전 + shortage try/catch graceful | ✅(개선) |
| 9 | `pages/dashboard.jsx` 카드 그리드 + 클릭 라우팅 | `window.DashboardPage`, Card×4, `setView` | ✅ |
| 10 | 카드 4종(마스터/재고/주간/규모) + tone 색상 | 4종 + bad/warn/ok 클래스 | ✅ |
| 11 | app.jsx NAV 항목 + 기본 view + 렌더 분기 | 3곳 반영, 기본 `'dashboard'` | ✅ |
| 12 | index.html script + 캐시 bump | dashboard?v=1, data-service/app v60 | ✅ |
| 13 | styles.css `.dash-*` + 토큰 fallback | 신설, `--bad/warn/ink-*` fallback 동봉 | ✅ |
| 14 | 단위 테스트 6 케이스 | 6 test 추가, 전부 GREEN | ✅ |

## 2. 설계와의 차이 (의도적 조정)

| 항목 | Design | 구현 | 사유 |
|---|---|---|---|
| NAV 위치 | 별도 그룹 `group:''` 최상단 | `'일일 작업'` 그룹 첫 항목 | 사이드바가 `sb-section`에 group명을 **항상 렌더** → 빈 그룹은 빈 헤더 div 발생. 기존 `history`(step 없는 항목)와 동일 패턴으로 편입해 회피 |
| week.dates | 배열 가정 | 객체 `{요일:'M/D'}`(getWeekInfo 실제) + 배열 모두 지원 | 코드 실태(`getWeekInfo`는 객체 반환) 반영. `todayDate` 추가로 "오늘 (6/8)" 표기 |
| shortage 방어 | null 분기만 | `try/catch` graceful | 진입 화면 견고성 — 부분/이상 data에도 throw 금지 |

→ 3건 모두 **설계 의도를 충족하면서 코드 실태에 맞춘 강화**. 기능 누락·축소 아님.

## 3. QA 결과 (Playwright, 정적 서버 8799 · clean.json fallback)

- 기본 진입 화면 = 대시보드 ✅
- 4카드 렌더: 마스터 정합성=정상 / 재고 부족=정상 / 이번 주=오늘 월요일(6/8)·주간 날짜 / 규모=제품 643·잉크 1599·약품 0 ✅
- **단일 출처 일치**: 규모 제품 643 == 사이드바 products 배지 643 / 마스터·재고 "정상" == bell "처리 필요 알림 없음" ✅
- 카드 클릭 라우팅: 재고 부족 카드 → `ink-plan`(breadcrumb "잉크 생산계획") ✅
- 콘솔 에러: `/api/*` 404 fallback만(정적 서버 특성) — 대시보드 코드 무관 ✅

## 4. 테스트

- `node --test` 3개 파일 = **102 tests, 102 pass, 0 fail** (회귀 0)
- 신규: buildDashboardSummary 6 케이스 (null 안전·master 교차검증·shortage 교차검증·masters 카운트·week)

## 5. Match Rate 산정

- 설계 14항목 전부 구현(100%), 차이 3건은 모두 **개선 방향 조정**(누락 0).
- 감점 요소: 설계 문서가 week.dates를 배열로, NAV를 별도 그룹으로 명시했으나 구현이 코드 실태에 맞춰 조정 → 문서-구현 표기 불일치 소폭.
- **Match Rate = 96%** (≥ 90% → iterate 불필요, Report 진행)

## 6. 결론

iterate 생략(96% ≥ 90%). 잔여 갭 없음. 완료 보고서로 진행.
