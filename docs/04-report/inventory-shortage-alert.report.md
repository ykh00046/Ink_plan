# 완료 보고서 — 재고 부족 예상 전역 알림 (inventory-shortage-alert)

> PDCA 사이클 완료 · 2026-06-08 · Match Rate 100% · bkit 추천 추가기능 2순위

## 1. 요약

bkit 추천 2순위("재고 부족 예상 알림 — inventory + injection 연결")를 PDCA 전 사이클로 완료했다.
조사 결과 부족 판정 데이터·정의(`computeInkMetrics().weeklyNeed`)는 이미 완전히 계산되고
ink-plan 페이지에 빨강으로 표시되고 있었으므로, 이 사이클의 본질은 [[unmapped-products-badge]]와
동일하게 **새 계산이 아니라 전역 가시성 확보**였다. 사용자가 어느 화면에 있든 "이번 주 소요를
못 버티는 잉크"를 인지하도록, 상시 노출되는 **사이드바 배지**와 **헤더 bell(알림 센터로 확장)**에
부족 신호를 연결했다.

## 2. 문제 → 해결

| | 내용 |
|---|---|
| **문제** | 재고 부족(월요일 현재고로 주간 총소요 불가, `weeklyNeed<0`)을 보려면 "잉크 생산계획" 페이지에 **직접 들어가야만** 했다. 다른 화면에서는 인지 못해 제조 지시·발주 타이밍을 놓쳐 주중 생산 중단으로 직결. |
| **해결** | `weeklyNeed<0` 잉크 수를 ① 사이드바 "잉크 생산계획" 항목 **주황 배지**, ② 헤더 bell([[unmapped-products-badge]]가 살린 UI)에 **마스터 결함과 합산**해 상시 노출. 클릭 시 해당 페이지로 이동. |
| **단일 출처** | 배지 수치 = `computeInkMetrics().weeklyNeed` 파생 → ink-plan 페이지 빨강 셀과 100% 동일 기준. 새 임계값 미발명. |

## 3. 구현 내역

| 파일 | 변경 |
|------|------|
| `data-service.js` | 순수 코어 `collectInkShortage(merged, computedByInk)`(weeklyNeed<0 수집·정렬·tooltip) + 어댑터 `buildInkShortageBadge(data, dates)`(기존 함수 합성) + export 2개. 현재고 미입력(null)은 자동 제외. |
| `app.jsx` | `inkShortage = useMemo([data, dates])` 파생(null-safe) / 헤더 bell을 **통합 알림 센터**로 확장(카운트 합산·tooltip 결합·tone 빨강(마스터)·주황(재고)·심각도 우선 라우팅) / 사이드바 'ink-plan' 주황 배지 / `APP_REV` 54→55. |
| `styles.css` | `.sb-item__badge--warn`(주황 warn 토큰 + fallback 동봉) — 마스터 결함 빨강과 시각 구분. |
| `tests/data-service.test.js` | `collectInkShortage` 단위 테스트 5케이스(없음/1건/정렬/null제외/tooltip'외'). |
| `index.html` | `data-service.js`·`app.jsx`·`styles.css` 캐시 버전 **v=58 통일**. |

## 4. 검증

- **단위 테스트**: 전체 91 GREEN (data-service 49 = 기존 44 + 신규 5, ui 21, date 21), fail 0
- **통합 스모크 (Node)**: 실제 data 구조 → 부족 잉크X(weeklyNeed −2) 1건 정확 식별, 충분·미입력 제외, clean=미표시
- **브라우저 QA (Playwright)**:
  - JSX 컴파일 0 errors, 앱 정상 로드
  - `collectInkShortage`·`buildInkShortageBadge` 런타임 함수 노출 확인
  - 부족 시나리오: show=true, count=1, tooltip "재고 부족 임박 1건 — 잉크X"
  - bell 회귀 없음: 현 데이터 마스터 결함 동작(빨강 "1" → 데이터 점검) 기존대로 보존
- **Gap Analysis**: Match Rate **100%** (12/12)

## 5. QA에서 마주친 환경 이슈·조치

| 이슈 | 원인 | 조치 |
|------|------|------|
| 기존 8765 포트 점유("Flow Notification Collector") | 다른 앱이 포트 선점 → server.py 즉시 종료 | 비침습 임시 런처로 **8799 포트** + ALLOWED_HOSTS monkeypatch 후 QA, 완료 후 런처 삭제 |
| 캐시 버전 불일치 | 작업 중 linter가 일부 파일을 v=57로 선반영 | 수정 3파일을 **v=58로 통일**해 무효화 확실화 |

## 6. 학습

- **"추가 기능"의 실체 검증이 또 유효**: [[unmapped-products-badge]]에 이어 2순위도 데이터·페이지 표시는 이미 존재했고, 본질은 "가시성"이었다. 코드 실태 조사로 중복 계산을 피하고 **기존 부족 정의(`weeklyNeed<0`)를 단일 출처로 재사용**해 페이지 표시와 불일치 위험을 제거.
- **bell을 알림 센터로 진화**: 이전 사이클이 살린 bell에 두 번째 알림 소스(재고)를 합산하며, 심각도 우선 라우팅·tone 분리로 단일 UI가 다중 알림을 책임지게 했다.
- **포트 선점 환경 대응**: 하드코딩 포트(8765) + Host 검증이 있는 서버는 QA 시 monkeypatch 임시 런처가 깔끔하다(소스 무수정).

## 7. 다음 단계 (bkit 추천 잔여)

| 우선순위 | 기능 | 비고 |
|---|------|------|
| 3 | 약품요청서 인쇄/PDF 출력 | chemicals.jsx에 인쇄 헤더 이미 존재 — 확장 |
| 4 | History 뷰 재검토 | 데이터 모델 한계([[project_history_view]] 참조) |
| — | `availableDays` 기반 일자별 임박 정밀 알림 | 이번 Scope 제외분 — 수요 시 별도 사이클 |
