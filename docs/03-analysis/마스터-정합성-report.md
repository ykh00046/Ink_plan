# PDCA 완료 보고서 — 마스터 정합성 검증 페이지 (Data Lint)

작성일: 2026-05-27
라운드: R2 #1 (이전 라운드: 약품요청서 + 코드 하드닝)
관련 문서:
- Plan:   `docs/01-plan/마스터-정합성.md`
- Design: `docs/02-design/마스터-정합성.md`
- 메모리: [[project-overview]] [[project-data-model]] [[product-matching-policy]]

## 1. 요약

`마스터 > 데이터 점검` 신규 페이지를 추가했다. 제품·잉크·사출계획 마스터 간 정합성 결함을 7개 카테고리로 분류·집계해 한 화면에 모아 보여주고, 행 클릭으로 해당 마스터 페이지로 즉시 이동할 수 있다.

- 새 페이지: `pages/data-quality.jsx` (~200 LOC)
- 새 순수 함수: `DataService.lintMasters(data, opts)` (~120 LOC, 정규화 함수 주입 지원)
- 신규 단위 테스트: 10개 (총 32개 모두 통과, 83ms)
- 영향받은 기존 파일: `app.jsx`(NAV+라우팅+REV), `index.html`(1줄), `styles.css`(~35줄), `data-service.js`(export 1줄), `tests/data-service.test.js`
- 영향받은 데이터 모델: **0** (read-only 집계)

## 2. 작업 내역 (PDCA 단계별)

| Phase | 산출물 | 비고 |
|---|---|---|
| Plan  | `docs/01-plan/마스터-정합성.md` | 7개 카테고리·시나리오·성공 기준 확정 |
| Design| `docs/02-design/마스터-정합성.md` | LintResult shape, 페이지 상태/CSS 결정 |
| Do    | `pages/data-quality.jsx`, `lintMasters`, NAV/라우팅/index.html 등록, `lint-*` CSS | ChemicalsPage 패턴 재사용 |
| Check | 단위 테스트 10개 추가·통과 (32/32 pass) + 실데이터 검증 (`clean.json` 11ms / 500건 산출) | Match Rate 95%+ |
| Act   | — (Iterate 불필요, 모든 IN scope·성공 기준 충족) | |
| Report| 본 문서 | |

## 3. 핵심 함수 — `lintMasters(data, opts)`

```js
// 입력
opts = { normalize?: (s: string) => string }
// 브라우저: ui.jsx의 normalizeProductName 주입
// 테스트: 미주입 시 UPPER+trim 기본 정규화

// 출력
{
  summary: {
    total: number,
    byCategory: { [code]: count },
    bySeverity: { error, warn, info },
  },
  issues: [
    { category, severity, label, target, detail, navTo, key }
  ]  // severity desc → category asc → target asc
}
```

### 7개 카테고리

| 코드 | severity | 검출 조건 | navTo |
|---|---|---|---|
| `product-not-in-master`    | error | injection 셀 제품명이 products[] 에 없음 (정규화 비교) | products |
| `product-no-inks`          | error | products[].inks가 전부 비어있음 | products |
| `ink-not-in-assignments`   | warn  | products[].inks에 있지만 machineAssignments에 없음 | machines |
| `ink-no-code`              | warn  | machineAssignments[].code 비어있음 | machines |
| `ink-no-machine`           | warn  | machineAssignments[].machine 비어있음 | machines |
| `duplicate-ink-assignment` | warn  | 같은 ink 이름이 2회 이상 등록 | machines |
| `orphan-ink-assignment`    | info  | machineAssignments에 있지만 어떤 product의 inks에도 등장 안 함 | machines |

## 4. 테스트 결과

```
$ npm test
# tests 32
# pass 32
# fail 0
# duration_ms 83.4
```

신규 테스트 10개:
1. 빈 데이터 → 이슈 0건, 충돌 없이 통과
2. 잉크 비어있는 제품 → product-no-inks (error)
3. 사출계획에 있으나 제품 마스터에 없으면 → product-not-in-master
4. 정규화 함수 주입 시 표기 차이 무시
5. 잉크 코드/호기 미입력 → warn
6. products[].inks 에 있지만 assignment 없으면 → ink-not-in-assignments
7. 사용되지 않는 잉크 마스터 → orphan (info)
8. 같은 잉크 이름 여러 행 → duplicate-ink-assignment
9. 정렬 순서 (severity desc → category → target asc)
10. byCategory/bySeverity 집계 정확

## 5. 실데이터 검증 (`data/clean.json`)

```
elapsed: 11 ms
total: 500
bySeverity: { error: 0, warn: 210, info: 290 }
byCategory: {
  'ink-no-code': 1,
  'ink-no-machine': 207,
  'ink-not-in-assignments': 2,
  'orphan-ink-assignment': 290
}
```

→ 현재 마스터 상태:
- **호기 미지정 잉크 207개** : 잉크는 등록됐지만 어느 호기에서 쓰는지 모름. 약품요청서에서 "미지정"으로 떨어지는 것들.
- **사용되지 않는 잉크 마스터 290개** : 옛 양산대응/단종 제품에서 쓰던 잉크가 그대로 마스터에 남아있음. 정리 후보.
- **품목코드 미입력 1개** (LSGALO) : 즉시 보완 가능.
- **products[].inks에는 있지만 assignment 누락 2개** : 약품요청서에서 "코드 미입력" 비고로 나오던 항목.

운영자가 첫 페이지 진입 시 즉시 보게 될 가치 있는 정보.

## 6. Plan 대비 Gap 분석

| Plan IN 항목 | 구현 | 비고 |
|---|---|---|
| `pages/data-quality.jsx` 신규 | ✅ | 200 LOC |
| `lintMasters(data, opts)` 순수 함수 | ✅ | normalize 주입 지원 |
| 7개 카테고리 분류 | ✅ | 코드/severity/navTo 모두 명세대로 |
| 카드 그리드 + 펼침/접힘 + 행 클릭 이동 | ✅ | expanded Set 관리 |
| 단위 테스트 | ✅ | 10개 (목표 5+ 초과) |
| NAV 마스터 그룹 등록 | ✅ | sparkle 아이콘 |
| `index.html` 스크립트 | ✅ | `?v=1` 캐시버스터 포함 |
| `styles.css` lint-* | ✅ | ~35줄 |

| 성공 기준 | 결과 |
|---|---|
| 빈 데이터 → 0건, 무사고 | ✅ test 1 |
| 7개 카테고리 분류 정확 | ✅ test 2-9 |
| 카드/행 클릭 인터랙션 | ✅ 구현 확인 (자동 검증 외) |
| 1000+ 셀에서 1초 이내 | ✅ 11ms (실데이터) |
| 단위 테스트 5+개 | ✅ 10개 |
| 기존 페이지 무영향 | ✅ read-only, NAV 1줄·뷰스위치 1줄 |

**Match Rate 추정: ≥ 95%** — Iterate 불필요.

## 7. 향후 신규 PDCA 후보 (R3+)

R1 보고서의 후속 작업 잔여분 + R2에서 새로 발견된 것:

- **마스터 정리(cleanup) 일괄 작업** : R2가 290개 orphan 잉크를 가시화했으니 이제 일괄 제거/아카이브 기능. 데이터 변경이라 신중하게 별도 PDCA.
- **약품 등급 필드 추가** (R1 잔여): `machineAssignments` 에 `chemicalGrade(38/43/55%)` 추가.
- **발주 이력 보관** (R1 잔여): 약품요청서 인쇄 시 스냅샷 저장.
- **잉크 소진일 예측** (R1 잔여): inventory.daily 시계열 분석.
- **OCR→검수 페이지 blob URL 이슈** (R1 코드리뷰 Info): preview 이미지가 OCR 페이지 언마운트 시 revoke되어 검수 페이지에서 깨질 수 있음.
- **재고 정합성 검사** : 이번 lintMasters 에서 의도적으로 제외했던 `data.inventory.lots` ↔ 잉크 마스터 검증.

## 8. 변경 파일 목록

```
A docs/01-plan/마스터-정합성.md
A docs/02-design/마스터-정합성.md
A docs/03-analysis/마스터-정합성-report.md
A pages/data-quality.jsx
M app.jsx                       (NAV 1줄, 뷰 스위치 1줄, APP_REV 48→49)
M index.html                    (스크립트 1줄)
M styles.css                    (lint-* 클래스 ~35줄)
M data-service.js               (lintMasters 함수 + export 1줄)
M tests/data-service.test.js    (테스트 10개 추가)
```

## 9. 운영자 안내

페이지 진입 즉시 다음을 우선 처리할 수 있다:
1. **심각만** 필터로 사출계획↔제품 마스터 결손 먼저 해결
2. **경고만** 필터로 잉크 마스터 보완 (호기/코드 비어있는 것 — 약품요청서 품질 직결)
3. **안내만** 필터로 unused 잉크 정리 검토 (운영 우선순위 낮음)
