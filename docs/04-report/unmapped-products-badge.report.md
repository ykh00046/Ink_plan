# 완료 보고서 — 마스터 정합성 전역 경고 배지 (unmapped-products-badge)

> PDCA 사이클 완료 · 2026-06-01 · Match Rate 100% · bkit 추천 추가기능 1순위

## 1. 요약

bkit 추천 1순위("마스터에 없는 제품 N건 경고 배지")를 PDCA 전 사이클로 완료했다.
조사 결과 경고 데이터(`lintMasters`)는 이미 완전히 계산되고 데이터 점검 페이지에도
표시되고 있었으므로, 이 사이클의 본질은 **새 계산 로직이 아니라 전역 가시성 확보**였다.
사용자가 어느 화면에 있든 처리 필요한 마스터 결함을 인지하도록, 상시 노출되는
**사이드바 배지**와 **헤더 알림(bell) 버튼**에 경고를 연결했다.

## 2. 문제 → 해결

| | 내용 |
|---|---|
| **문제** | 마스터 결함(사출계획에 있으나 마스터에 없는 제품·잉크 빈 제품)을 보려면 "데이터 점검" 페이지에 **직접 들어가야만** 했다. 일상 작업 중에는 결함을 인지하지 못해 발주·생산 누락으로 직결. |
| **해결** | `lintMasters` error 건수를 ① 사이드바 "데이터 점검" 항목 빨간 배지, ② 헤더 bell 버튼(무동작이던 죽은 UI 활성화)에 상시 노출. 클릭 시 데이터 점검 페이지로 이동. |
| **단일 출처** | 배지 수치 = `lintMasters().summary` 파생 → 데이터 점검 페이지와 100% 동일 보장. |

## 3. 구현 내역

| 파일 | 변경 |
|------|------|
| `data-service.js` | 순수 함수 `buildMasterHealthBadge(lintSummary)` 추가 (`{errorCount, notInMaster, noInks, show, tooltip}` 반환) + export. error 심각도만 배지화(알람 피로 방지). |
| `app.jsx` | `masterHealth = useMemo([data])` 파생 / 헤더 bell 버튼 활성화(클릭 → `setView('data-quality')`, 빨강 강조, 카운트) / 사이드바 'data-quality' 항목 배지. `APP_REV` 53→54. |
| `styles.css` | `.sb-item__badge--alert` (연빨강 배경 + 진빨강 글자, fallback 동봉) |
| `tests/data-service.test.js` | `buildMasterHealthBadge` 단위 테스트 5케이스 |
| `index.html` | `app.jsx?v=55`, `styles.css?v=55` 캐시 버전 쿼리 (app.jsx엔 버전 쿼리가 없던 캐시 사각 해소) |

## 4. 검증

- **단위 테스트**: 전체 79개 GREEN (data-service 44 = 기존 39 + 신규 5, ui 14, date 21), fail 0
- **브라우저 QA (Playwright)**:
  - JSX 컴파일 0 errors
  - 깨끗한 데이터 → 배지 미표시 / bell "마스터 데이터 정상"
  - 결함 주입 → 사이드바·bell 빨강 "2" + tooltip "데이터 점검 필요 — 마스터에 없는 제품 1건 · 잉크 미등록 제품 1건"
  - bell 클릭 → 데이터 점검 페이지 이동, 페이지 "심각 2" == 배지 "2" 수치 일치
- **Gap Analysis**: Match Rate **100%** (gap-detector)

## 5. QA에서 발견·수정한 결함

| 결함 | 원인 | 조치 |
|------|------|------|
| 변경한 app.jsx가 화면에 반영 안 됨 | app.jsx에 캐시 버전 쿼리 부재 → 브라우저 캐시 | `app.jsx?v=55`, `styles.css?v=55` 부여 |
| bell 활성화 시 배경 투명 | 설계 초안의 `--bad-50/300/700`이 `:root`에 미정의 + fallback 없음 | 존재 변수 `--bad-100`/`--bad-600` + fallback으로 교체. 설계 문서도 코드에 맞춰 정정 |

## 6. 학습

- **"추가 기능"의 실체 검증이 우선**: 추천 1순위는 "배지 신설"처럼 보였으나, 데이터·전용 페이지는 이미 존재했다. 코드 실태 조사로 작업의 본질을 "계산"이 아닌 "가시성"으로 재정의해 중복 구현을 피했다.
- **CSS 변수는 존재 여부를 먼저 확인**: 디자인 토큰(`--bad-*`)이 부분적으로만 정의된 시스템에서는 fallback 동봉이 필수. QA에서 투명 배경으로 드러났다.
- **app.jsx 캐시 버전 쿼리 부재**가 구조적 사각이었다 — 메모리에 기록된 "jsx 캐시" 이슈가 재현됨.

## 7. 다음 단계 (bkit 추천 잔여)

| 우선순위 | 기능 | 비고 |
|---|------|------|
| 2 | 재고 부족 예상 알림 (inventory + injection 연결) | `buildInventoryByInkDay`·`computeInkMetrics` 기존 자산 활용 가능 |
| 3 | 약품요청서 인쇄/PDF 출력 | chemicals.jsx에 인쇄 헤더 이미 존재 — 확장 |
| 4 | History 뷰 재검토 | 데이터 모델 한계(메모리 `project_history_view` 참조) |

## 8. PDCA 단계 기록

`[Plan]` OK → `[Design]` OK → `[Do]` OK → `[Check]` OK (100%) → `[Report]` OK
- iterate 미실행 (Match Rate 100% ≥ 90%)
- 미커밋 상태 — 사용자 커밋 지시 시 진행
