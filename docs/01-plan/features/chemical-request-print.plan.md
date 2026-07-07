# Plan — 약품요청서 인쇄물 완성 (chemical-request-print)

> PDCA Plan · 2026-06-08 · bkit 추천 추가기능 3순위 · [[unmapped-products-badge]]·[[inventory-shortage-alert]] "실태조사 후 진짜 갭" 패턴 확장

## 1. 배경

bkit 추천 3순위는 "약품요청서 인쇄/PDF 출력 (chemicals.jsx에 인쇄 헤더 이미 존재 — 확장)"이다.
코드 실태를 조사한 결과, **인쇄 메커니즘은 이미 완성되어 있다**:

- `pages/chemicals.jsx` → `window.print()` 버튼 + TSV 복사 + 인쇄 전용 헤더(`.chem-print-header`) 존재
- `styles.css` `@media print` → A4 세로, UI 크롬 숨김, thead 반복(`table-header-group`), 셀 테두리·페이지 분할 회피 모두 구현됨

즉 1·2순위와 **동일한 갭 구조**다 — "신규 기능"이 아니라 **확장**이 본질. 따라서 새 인쇄 파이프라인을
만드는 게 아니라, 이미 출력되는 인쇄물의 **실무 결함**을 메운다.

## 2. 문제 정의 (진짜 갭)

현재 인쇄물(약품요청서 = 잉크 발주 요청서)에는 회람·결재용 양식으로서 두 가지 실무 결함이 있다:

1. **작성자 하드코딩** — `chemicals.jsx:188`에 `작성자: 김선명 (생산관리팀)`이 **소스에 박혀 있다**.
   다른 담당자가 출력해도 항상 "김선명"으로 찍혀 **틀린 작성자**가 인쇄된다. 인사이동 시 소스 수정 필요.

2. **결재란/서명란 부재** — "발주 요청서"는 구매처·결재라인으로 **회람되는 문서**인데,
   작성/검토/승인 **도장란이 없다**. 현재 인쇄물은 표만 있어 결재 문서로 바로 쓸 수 없다.
   (한국 제조업 표준 요청서는 우측 상단 또는 하단에 결재란을 둠)

추가로 인쇄물에는 **문서번호가 없어** 발주 이력 추적·재발행 식별이 불가하다.

## 3. 목표

인쇄물을 **그대로 결재·회람 가능한 발주 요청서**로 완성한다. 데이터 변경 없음(read-only).

1. **작성자 설정화** — 하드코딩 제거. 작성자명·팀을 `tweaks`(사용자 로컬 선호 채널, 영속화)에서 읽음.
   - 설정 패널(`TweaksControls`)에 "발주 작성자명" 입력 추가
   - 미설정 시 안전한 fallback(`생산관리팀`) — 빈 문자열이 찍히지 않게

2. **결재란 추가** — 인쇄물에만 표시되는 결재 박스(작성 / 검토 / 승인 3칸). 화면에서는 숨김(`@media print`만).

3. **문서번호** — `약품-YYYYMMDD` 형식(작성일 기반). 인쇄 헤더에 표기 → 발주 식별·추적.

## 4. 범위 (Scope)

### In Scope
- 순수 함수 `buildChemicalRequestMeta(totals, rangeLabel, requester, todayISO)` 신설 (data-service.js, 테스트 가능)
  - 작성자 fallback 로직 / 문서번호 포맷 / 1줄 요약 / 결재 역할 roster를 한 곳에서 산출
- `chemicals.jsx`: 인쇄 헤더가 위 메타를 사용하도록 교체 + 결재란 JSX 블록 추가
- `app.jsx`: `TweaksControls`에 작성자명 입력 + `TWEAK_DEFAULTS`에 `requester` 기본값
- `styles.css`: `@media print` 결재란(`.chem-approval`) 스타일 (화면 숨김 + 인쇄 표시)
- 단위 테스트(`buildChemicalRequestMeta` 케이스) + 캐시 버전 쿼리 bump

### Out of Scope
- 백엔드 `/api/settings` 스키마 변경 (작성자는 로컬 선호값 → `tweaks` 채널 재사용, 백엔드 무변경)
- 결재 전자서명·승인 워크플로우 (이 시스템은 단일 화면 SPA — 종이 결재 전제)
- 발주 이력 영속 저장/문서번호 시퀀스 채번 (날짜 기반 식별로 충분, 과설계 방지)
- 다른 페이지(injection/inventory 등) 인쇄물 — 본 사이클은 약품요청서 한정

## 5. 비목표 / 리스크

| 리스크 | 대응 |
|---|---|
| 작성자 설정을 백엔드에 추가 → 서버 스키마·마이그레이션 리스크 | `tweaks` 채널 재사용(showRowNum·테마와 동일). 백엔드 무변경 |
| 작성자 미설정 시 빈 이름 인쇄 | 순수 함수에서 `trim() || '생산관리팀'` fallback — 빈 문자열 차단 |
| 결재란이 화면에도 노출되어 UI 깨짐 | `@media print`에서만 `display` 부여, 평소 `display:none` (`.chem-print-header` 패턴 동일) |
| 문서번호에 `Date()` 사용 → 순수함수 테스트 불가 | `todayISO`를 인자로 주입(기존 `localDateISO()` 결과 전달), 코어는 순수 유지 |
| 결재란이 표 마지막 페이지와 분리되어 빈 페이지 발생 | `page-break-inside: avoid` + 헤더 우측 배치 우선 검토(Design에서 확정) |

## 6. 성공 기준

- 화면: 작성자명을 설정 패널에서 변경 → 인쇄 헤더 작성자 즉시 반영 (하드코딩 "김선명" 제거 확인)
- 작성자 미설정/공백 → 인쇄물에 `생산관리팀` fallback (빈 이름 없음)
- 인쇄(Print 미리보기): 결재란 3칸(작성/검토/승인) 표시 + 문서번호 `약품-YYYYMMDD` 표기
- 화면(비인쇄): 결재란 미표시 — 기존 레이아웃 회귀 0
- 단위 테스트 GREEN (`buildChemicalRequestMeta` 신규 케이스 포함), 기존 테스트 회귀 0
- Gap Analysis Match Rate ≥ 90%

## 7. 다음 단계 (bkit 추천 잔여)

| 우선순위 | 기능 | 비고 |
|---|------|------|
| 4 | History 뷰 재검토 | 데이터 모델 한계([[project_history_view]] 참조) |
| — | `availableDays` 기반 일자별 임박 정밀 알림 | 별도 사이클 |
