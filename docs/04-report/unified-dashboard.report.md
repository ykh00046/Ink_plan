# 완료 보고서 — 통합 대시보드 (unified-dashboard)

> PDCA 사이클 완료 · 2026-06-08 · Match Rate 96% · 102 tests GREEN · bkit 추천 1~3순위 완료 후 최고가치 신규

## 1. 요약

bkit 추천 1~3순위([[unmapped-products-badge]]·[[inventory-shortage-alert]]·[[chemical-request-print]])를
모두 완료한 뒤, 세 사이클의 공통 학습 **"핵심 지표는 이미 계산되나 각 페이지에 들어가야만 보인다"**의
자연스러운 귀결로 **통합 대시보드**를 신설했다. 흩어진 신호(마스터 정합성·재고 부족·이번 주
일정·마스터 규모)를 **진입 화면 한 곳에 요약 + 1클릭 라우팅**한다.

핵심: **새 계산 0**. `lintMasters→buildMasterHealthBadge`·`buildInkShortageBadge`·`computeInkMetrics`
등 **기존 어댑터를 `buildDashboardSummary` 순수 함수로 합성**만 했다. 따라서 대시보드 수치는
각 페이지·사이드바 배지·헤더 bell과 **항상 동일 출처로 일치**한다.

## 2. 구현 내역

| 파일 | 변경 |
|---|---|
| `data-service.js` | `buildDashboardSummary(data,dates,opts)` 신설(순수·null-safe·try/catch graceful) + exports |
| `pages/dashboard.jsx` | 신설 — `window.DashboardPage`, 카드 4종 + `ctx.setView` 클릭 라우팅 |
| `app.jsx` | NAV '일일 작업' 최상단 대시보드 항목 / 기본 view `'dashboard'` / 렌더 분기 |
| `index.html` | `dashboard.jsx?v=1` 등록 + `data-service`/`app` 캐시 v60 bump |
| `styles.css` | `.dash-grid`/`.dash-card`(+bad/warn) — 색 토큰 fallback 동봉 |
| `tests/data-service.test.js` | `buildDashboardSummary` 6 케이스(교차검증 포함) |

### 카드 4종
| 카드 | 출처(단일) | 클릭 → |
|---|---|---|
| 마스터 정합성 | `lintMasters` | data-quality |
| 재고 부족 임박 | `buildInkShortageBadge` (`weeklyNeed<0`) | ink-plan |
| 이번 주 일정 | `getWeekInfo` today/dates | injection |
| 마스터 규모 | products/inkPlan/chemicals 카운트 | products |

## 3. 검증

- **단위 테스트**: `node --test` 3파일 = **102 pass / 0 fail**(회귀 0). 신규 6 케이스는
  master·shortage를 기존 어댑터와 **교차검증**해 단일 출처 일치를 코드로 고정.
- **QA**(Playwright, 정적 서버 8799 · clean.json fallback):
  - 기본 진입=대시보드, 4카드 정상 렌더
  - 실데이터: 제품 643·잉크 1599·약품 0, 오늘 월요일(6/8) + 주간 날짜
  - **3중 일치**: 규모 제품 643 == 사이드바 products 배지 / 마스터·재고 "정상" == bell "처리 필요 알림 없음"
  - 카드 클릭 → 정확한 페이지 라우팅(재고→ink-plan)
  - 스크린샷: [[unified-dashboard-preview.png]] (docs/03-analysis)

## 4. 설계와의 차이 (의도적 강화)

| 항목 | 조정 | 사유 |
|---|---|---|
| NAV 위치 | 별도 그룹 → '일일 작업' 첫 항목 | `sb-section`이 group명 항상 렌더 → 빈 헤더 회피(history 패턴 재사용) |
| week.dates | 배열 가정 → 객체+배열 모두 지원 + `todayDate` | `getWeekInfo` 실제 반환(객체) 반영, "오늘 (6/8)" 표기 |
| shortage 방어 | null 분기 → try/catch graceful | 진입 화면 견고성 |

## 5. 학습

- **4사이클째 "추가 기능의 실체는 기존 자산의 가시성"**: 배지·알림에 이어 대시보드도
  핵심은 신규 계산이 아니라 **이미 있는 어댑터의 합성·노출**이었다. 코드 실태 조사가
  매번 중복 구현을 막고 **단일 출처 일치**를 보장했다.
- **교차검증 테스트가 단일 출처를 강제**: `dashboard.shortage.count === buildInkShortageBadge().shortageCount`
  형태로 묶어, 향후 한쪽만 바뀌면 테스트가 깨지도록 회귀 안전망을 설치.
- **코드 실태가 설계를 정정**: design의 배열 가정·별도 NAV 그룹은 실제 `getWeekInfo` 객체 반환과
  `sb-section` 렌더 방식에 부딪혀 구현 단계에서 강화 조정됐다. ([[feedback_dev_environment]] jsx 캐시 교훈도 재적용 — v60 bump)
- **포트 선점 재확인**: 8765는 타 앱("Flow Notification Collector") 점유. QA는 임시 정적
  서버(8799)+clean.json fallback으로 소스 무수정 수행(read-only 대시보드라 적합).

## 6. PDCA 단계 기록

`[Plan]` OK → `[Design]` OK → `[Do]` OK → `[Check]` OK (96%) → `[Report]` OK
- iterate 미실행 (Match Rate 96% ≥ 90%)
- 미커밋 상태 — 사용자 커밋 지시 시 진행

## 7. 다음 단계 (bkit 추천 잔여)

| 우선순위 | 기능 | 비고 |
|---|------|------|
| 4 | History 뷰 재검토 | 데이터 모델 한계([[project_history_view]]) — 대시보드 추세 카드도 동일 한계 공유 |
| — | `availableDays` 기반 일자별 임박 정밀 알림 | 대시보드 재고 카드에 후속 통합 가능 |
| — | 약품 재고 부족 판정 | chemicals 데이터 모델 확장 시 대시보드 카드 tone 연동 |
| — | 결재란 라벨/칸 수 설정화 | 수요 시 tweaks 확장 |
