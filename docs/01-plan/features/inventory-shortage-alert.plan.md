# Plan — 재고 부족 예상 전역 알림 (inventory-shortage-alert)

> PDCA Plan · 2026-06-08 · bkit 추천 추가기능 2순위 (저비용·고효용) · [[unmapped-products-badge]] 패턴 확장

## 1. 배경

bkit 추천 2순위는 "재고 부족 예상 알림 (inventory + injection 연결)"이다.
코드 실태를 조사한 결과, **부족 판정에 필요한 데이터·정의는 이미 완전히 계산되고 있다**:

- `data-service.js` `computeInkMetrics()` → 잉크×요일별 `stock`(현재고) / `required`(소요) /
  `manufacture`(제조량) / `availableDays`(며칠치) / **`weeklyNeed`(월요일 현재고 − 주간 총소요)** / `endStock` 산출
- `pages/ink-plan.jsx`(잉크 생산계획) → `weeklyNeed < 0`이면 셀을 **빨강(`--bad-600`)** 으로 표시 (line 158)
- 동일 기준이 auto-assign 후보 계산에도 사용됨 ("월요일 필요수량이 음수(부족)인 정식 잉크에 제조량 자동 채움", line 204)

즉 `weeklyNeed < 0`은 **이미 이 시스템의 공식 "재고 부족" 정의**다.
따라서 이 사이클은 **새 임계값·계산을 발명하는 것이 아니라**, 이미 있는 부족 신호의
**전역 가시성**을 확보하는 작업이다. ([[unmapped-products-badge]]와 동일한 갭 구조)

## 2. 문제 정의 (진짜 갭)

현재 사용자는 **"잉크 생산계획" 페이지로 직접 들어가야만** 재고 부족을 본다.
사출계획·재고조사·약품요청서·데이터 점검 등 다른 화면에서는 다음을 **전혀 인지하지 못한다**:

- 월요일 현재고로 **이번 주 소요를 못 버티는 잉크** (= `weeklyNeed < 0`)
- → 제조 지시·발주 타이밍을 놓쳐 **주중 생산 중단**으로 직결

전역 알림에는 [[unmapped-products-badge]]가 마스터 정합성(error)만 연결해 두었고,
**재고 부족은 어떤 전역 위치에도 노출되지 않는다.** "지금 부족 임박 잉크가 N건"을
**어느 화면에 있든** 항상 보이게 만드는 것이 핵심 가치다.

## 3. 목표

상시 노출되는 두 위치에 재고 부족 경고를 추가한다. 단일 출처 = `computeInkMetrics().weeklyNeed`.

1. **사이드바 "잉크 생산계획" 항목 배지**
   - `weeklyNeed < 0`인 잉크 수를 배지로 표시 (products/test-inks/[[unmapped-products-badge]] 배지 패턴 재사용)
   - 마스터 결함(빨강 error)과 **시각적으로 구분** — 부족은 **주황(warn)** 계열
   - 0건이면 배지 미표시

2. **헤더 알림(bell) 통합** — [[unmapped-products-badge]]가 살린 bell을 "알림 센터"로 확장
   - bell 카운트 = 마스터 error + 재고 부족 **합산**
   - tooltip = "마스터에 없는 제품 N건 · 잉크 미등록 M건 · **재고 부족 임박 K건**"으로 분해
   - 클릭 시 이동: **마스터 error > 0 이면 `data-quality`(기존 동작 유지), 아니면 `ink-plan`** (심각도 우선)

## 4. 범위 (Scope)

### In Scope
- 순수 함수 `buildInkShortageBadge(merged, computedByInk)` 신설 (data-service.js, 테스트 가능)
- app.jsx: `inkShortage` useMemo 파생 + 사이드바 ink-plan 배지 + bell 통합/분해/클릭 라우팅
- styles.css: 주황(warn) 배지 변형 (`--warn-*` 토큰 존재 여부 확인 후 fallback 동봉)
- 단위 테스트 + 캐시 버전 쿼리 bump

### Out of Scope
- `availableDays` 기반 일자별 임박 정밀 알림 (별도 사이클 — 과설계 방지)
- 약품(chemicals) 재고 부족 (현재 데이터 모델상 잉크와 동일 구조 아님)
- 알림 이력/스누즈/푸시 등 (이 시스템은 단일 화면 SPA)

## 5. 비목표 / 리스크

| 리스크 | 대응 |
|---|---|
| 부족 기준을 새로 발명 → 페이지 표시와 불일치 | `weeklyNeed < 0` **그대로 재사용**(단일 출처). 페이지 빨강과 100% 일치 |
| 현재고 미입력 잉크가 "부족"으로 오탐 | `weeklyNeed`는 stock=null이면 null → **자동 제외**(판단 불가 항목은 카운트 안 함) |
| 주황 토큰(`--warn-*`) 미정의로 투명 배경 | [[unmapped-products-badge]] QA 교훈 — 존재 변수 확인 + fallback 동봉 |
| bell 통합으로 기존 마스터 알림 동작 회귀 | 마스터 error>0 클릭 라우팅은 **기존대로 data-quality 유지**, 재고는 보조 |

## 6. 성공 기준

- 깨끗한 데이터(부족 0) → 배지 미표시 / bell 카운트에 재고분 미합산
- `weeklyNeed < 0` 잉크 주입 → 사이드바 ink-plan 주황 배지 + bell 카운트 합산 + tooltip 분해
- 배지 수치 == ink-plan 페이지 빨강 셀 잉크 수 (단일 출처 일치)
- 단위 테스트 GREEN (신규 케이스 포함), 기존 테스트 회귀 0
- Gap Analysis Match Rate ≥ 90%

## 7. 다음 단계 (bkit 추천 잔여)

| 우선순위 | 기능 | 비고 |
|---|------|------|
| 3 | 약품요청서 인쇄/PDF 출력 | chemicals.jsx에 인쇄 헤더 이미 존재 — 확장 |
| 4 | History 뷰 재검토 | 데이터 모델 한계([[project_history_view]] 참조) |
