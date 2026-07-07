# Plan — 통합 대시보드 (unified-dashboard)

> PDCA Plan · 2026-06-08 · bkit 추천 후속(1~3순위 완료 후 최고가치 신규) · [[unmapped-products-badge]]·[[inventory-shortage-alert]]·[[chemical-request-print]] 패턴의 귀결

## 1. 배경

bkit 추천 1~3순위(마스터 정합성 배지·재고 부족 알림·약품요청서 인쇄)를 모두 완료했다.
세 사이클의 **공통 학습**은 일관됐다:

> "핵심 지표는 이미 `data-service.js`에서 완전히 계산되고 있으나, **각 페이지에 들어가야만 보인다**."

그 결과 전역 가시성 장치(사이드바 배지·헤더 bell 알림센터)가 점진적으로 자랐다. 그러나
bell은 **마스터 error + 재고 부족**만 합산하는 *경보용 좁은 채널*이고, 운영자가
"오늘 무엇부터 봐야 하나"를 **한눈에 조망하는 진입 화면**은 여전히 없다.

코드 실태 조사 결과, 대시보드가 모을 데이터는 **이미 전부 계산되며 어댑터까지 존재**한다:

- `lintMasters(data, {normalize})` → 마스터 정합성 summary (error/warn 카운트) — [[unmapped-products-badge]]
- `buildInkShortageBadge(data, dates)` → 재고 부족 임박 잉크(`weeklyNeed<0`) 수·목록·tooltip — [[inventory-shortage-alert]]
- `computeInkMetrics(...)` → 잉크×요일 stock/required/weeklyNeed/availableDays
- `data.products / data.inks(마스터) / data.chemicals` → 마스터 규모 카운트
- `ctx.today / ctx.dates` → 이번 주 영업일 정보

즉 이 사이클은 **새 계산을 발명하는 것이 아니라**, 이미 있는 신호들을
**하나의 진입 화면에 요약·라우팅**하는 가시성 통합 작업이다. (3사이클과 동일한 갭 구조)

## 2. 문제 정의 (진짜 갭)

1. **진입 화면이 작업 페이지(`inventory`)** 라서, 운영자는 부팅 직후 시스템 전체 상태를
   파악하지 못하고 곧바로 한 작업에 빠진다. "지금 가장 급한 게 뭔지"의 조망이 없다.
2. bell은 **카운트와 tooltip만** 제공 — *무엇이* 부족한지(잉크명), 마스터 결함의 *내역*,
   이번 주 날짜 맥락을 보려면 결국 각 페이지를 순회해야 한다.
3. 흩어진 신호(마스터·재고·주간 일정·마스터 규모)를 **연결해서 보여주는 단일 출처**가 없다.

## 3. 목표

상시 진입 가능한 **통합 대시보드 페이지**를 신설하고, **기본 진입 화면**으로 둔다.
모든 수치의 단일 출처 = 기존 어댑터(`lintMasters`·`buildInkShortageBadge`·`computeInkMetrics`).

1. **요약 카드 그리드** — 각 카드는 핵심 지표 + 클릭 시 해당 페이지로 라우팅(`ctx.setView`)
   - **마스터 정합성**: error/warn 건수, 0이면 "정상" → `data-quality`
   - **재고 부족 임박**: `weeklyNeed<0` 잉크 수 + 가장 부족한 상위 N개 잉크명 → `ink-plan`
   - **이번 주 일정**: 오늘 요일·날짜, 주간 영업일 dates → `injection`
   - **마스터 규모**: 제품/잉크/약품 마스터 건수 (참고용, 비경보) → `products`
2. **심각도 시각화** — error=빨강(`--bad-*`), 부족=주황(`--warn-*`), 정상=중립. 기존 토큰 재사용 + fallback.
3. **기본 진입 변경** — `useState('inventory')` → `'dashboard'`. 사이드바 최상단 신규 그룹/항목.

## 4. 범위 (Scope)

### In Scope
- 순수 함수 `buildDashboardSummary(data, dates, opts)` 신설 (data-service.js, 테스트 가능)
  - 기존 어댑터 합성 → `{ master, shortage, week, masters }` 단일 모델 반환. null-safe.
- `pages/dashboard.jsx` 신설 — `window.DashboardPage`, 카드 그리드 + 클릭 라우팅
- app.jsx: NAV 최상단 `대시보드` 항목 + 렌더 분기 + 기본 view `'dashboard'`
- index.html: `pages/dashboard.jsx?v=1` script 등록
- styles.css: `.dash-*` 카드 그리드 스타일 (기존 색 토큰 재사용 + fallback)
- 단위 테스트(`buildDashboardSummary` 케이스) + 영향받은 jsx 캐시 버전 bump

### Out of Scope
- 추세/그래프·기간 비교 차트 (데이터 모델상 시계열 스냅샷 부재 — [[project_history_view]] 한계)
- 약품(chemicals) 재고 부족 판정 (잉크와 데이터 구조 상이 — 단순 마스터 카운트만)
- 대시보드 위젯 커스터마이즈/드래그 (과설계 방지, 단일 화면 SPA)
- bell 동작 변경 (이미 [[inventory-shortage-alert]]에서 완성 — 회귀 금지)

## 5. 비목표 / 리스크

| 리스크 | 대응 |
|---|---|
| 대시보드 수치가 페이지/배지와 불일치 | **기존 어댑터 그대로 재사용**(단일 출처). 새 임계값 발명 금지 |
| 기본 진입 변경으로 기존 사용자 흐름 혼란 | 대시보드는 한눈 요약 + 1클릭이면 작업 페이지 도달. 사이드바 그대로 유지 |
| 색 토큰(`--warn-*`/`--bad-*`) 미정의 투명 배경 | [[unmapped-products-badge]] QA 교훈 — 존재 변수 확인 + fallback 동봉 |
| data===null 초기 로드 시 깨짐 | `buildDashboardSummary` null-safe, 페이지도 빈 상태(0/정상) 렌더 |
| 카드 클릭 라우팅이 잘못된 페이지로 | `ctx.setView` NAV id와 정확히 매핑(테스트 NAV id 대조) |

## 6. 성공 기준

- 진입 시 대시보드가 기본 노출, 4종 카드가 현재 데이터 요약 표시
- 깨끗한 데이터 → 마스터/재고 카드 "정상"(중립색), 결함 주입 → 빨강/주황 + 건수
- 재고 카드 부족 수 == `ink-plan` 빨강 셀 수 == bell 재고분 (단일 출처 3중 일치)
- 카드 클릭 → 매핑된 페이지로 정확히 이동
- `buildDashboardSummary` 단위 테스트 GREEN, 기존 테스트 회귀 0
- Gap Analysis Match Rate ≥ 90%

## 7. 다음 단계 (bkit 추천 잔여)

| 우선순위 | 기능 | 비고 |
|---|------|------|
| 4 | History 뷰 재검토 | 데이터 모델 한계([[project_history_view]]) — 대시보드 추세 카드도 동일 한계 공유 |
| — | `availableDays` 기반 일자별 임박 정밀 알림 | 대시보드 재고 카드에 후속 통합 가능 |
| — | 결재란 라벨/칸 수 설정화 | 수요 시 tweaks 확장 |
