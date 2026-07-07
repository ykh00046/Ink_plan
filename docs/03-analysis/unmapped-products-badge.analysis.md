# Gap Analysis — 마스터 정합성 전역 경고 배지 (unmapped-products-badge)

> PDCA Check · 2026-06-01 · gap-detector + 브라우저 QA 통합

## 분석 개요

- **Feature**: unmapped-products-badge
- **Plan**: `docs/01-plan/features/unmapped-products-badge.plan.md`
- **Design**: `docs/02-design/features/unmapped-products-badge.design.md`
- **구현**: `data-service.js`, `app.jsx`, `styles.css`, `tests/data-service.test.js`, `index.html`

## 종합 점수

| 항목 | 점수 | 상태 |
|------|:----:|:----:|
| 설계 일치 (DoD + 설계 항목) | 100% | OK |
| 아키텍처 준수 (IIFE 순수함수 경계·단일 출처) | 100% | OK |
| 컨벤션 준수 (네이밍/로드순서/캐시버전) | 100% | OK |
| **Match Rate** | **100%** | OK |

## DoD vs 구현

| DoD / 설계 항목 | 상태 | 근거 |
|------|------|------|
| App에서 `lintMasters(data,{normalize})` 1회 useMemo | OK | `app.jsx` `masterHealth = useMemo(..., [data])` |
| 배지 카운트 = lintMasters 단일 출처 | OK | `buildMasterHealthBadge(lint.summary)`, 별도 산출 없음 |
| `buildMasterHealthBadge` 순수 함수 + export | OK | `data-service.js` 정의 + return 객체 export |
| 입력 null/누락 방어 | OK | `lintSummary‖{}`, `bySeverity‖{}`, `byCategory‖{}` |
| error 심각도만 배지화 | OK | `errorCount=bySeverity.error`, `show=errorCount>0` |
| 사이드바 'data-quality' 배지 (0이면 미표시, 빨강) | OK | `masterHealth.show` 가드 + `sb-item__badge--alert` |
| 헤더 bell 활성화 (카운트 + 클릭 시 data-quality 이동) | OK | onClick `setView('data-quality')` + 카운트 span |
| 분해 tooltip | OK | "데이터 점검 필요 — 마스터에 없는 제품 N건 · 잉크 미등록 제품 M건" |
| `.sb-item__badge--alert` 클래스 | OK | `styles.css` 베이스+빨강, fallback 동봉 |
| 단위 테스트 5케이스 | OK | `tests/data-service.test.js` 정상/누락만/복합/null/lint연동 |
| 동작 보존 (회귀 0) | OK | 전체 79개 GREEN, fail 0 |
| 캐시 버전 쿼리 | OK | `index.html` `app.jsx?v=55`, `styles.css?v=55` |

## 차이점

### 누락 (설계 O, 구현 X)
없음.

### 추가 (설계 X, 구현 O)
없음 — 비목표(lintMasters 로직/카테고리 변경, data-quality UI 개편) 모두 미침범.

### 변경 (경미, 일관성 개선)

| 항목 | 설계 초안 §3.3 | 구현 | 처리 |
|------|------|------|------|
| bell 활성화 색상 변수 | `--bad-50/300/700` (fallback 없음) | `--bad-100`/`--bad-600` + fallback | **설계 문서를 코드에 맞춰 정정 완료** |

**근거**: `:root`에 실제 정의된 변수는 `--bad-100`·`--bad-600`뿐(`--bad-50/300/700` 미정의).
설계 §3.3 초안의 토큰을 그대로 두면 bell 배경이 투명해지는 결함이 발생 → 브라우저 QA에서
발견하여 사이드바 배지(§4)와 동일하게 존재 변수+fallback으로 통일. 설계 §3.3·§4의 내부
불일치를 §4 기준으로 해소한 것으로, "코드가 진실" 원칙에 따라 **설계 문서를 정정**했다.

## 브라우저 QA 결과 (Playwright)

| 검증 | 결과 |
|------|------|
| JSX 컴파일 | 0 errors (콘솔 error는 정적 서버 `/api` 404 fallback뿐) |
| 함수 노출 | `window.DataService.buildMasterHealthBadge` 존재·정확 |
| 깨끗한 데이터 | 배지 미표시, bell title "마스터 데이터 정상" |
| 결함 데이터 주입 (GHOST_PROD + 빈잉크 제품) | 사이드바 배지 "2" + bell 빨강 "2" |
| tooltip 분해 | "데이터 점검 필요 — 마스터에 없는 제품 1건 · 잉크 미등록 제품 1건" |
| 시각 강조 | 연빨강 배경(`oklch(0.95 0.05 25)`) + 진빨강 글자(`oklch(0.55 0.18 25)`) |
| bell 클릭 | 데이터 점검 페이지 이동 성공 |
| 수치 일치 | 페이지 "심각 2" == 배지 "2" (단일 출처 검증) |

## 결론

- **Match Rate 100% (≥ 90%)** → iterate 불필요, Check 완료.
- 발견된 유일한 결함(bell 투명 배경)은 QA 단계에서 즉시 수정·재검증 완료.
- 다음 단계: `/pdca report unmapped-products-badge` (완료 보고서).
