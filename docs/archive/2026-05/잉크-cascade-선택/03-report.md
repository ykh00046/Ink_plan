# PDCA 완료 보고서 — 잉크 선택 제약(cascade) · 제품 마스터 잉크 슬롯

작성일: 2026-05-29
관련 문서:
- Plan: `docs/01-plan/잉크-cascade-선택.md`
- Design: `docs/02-design/잉크-cascade-선택.md`
- 회귀 리뷰: `docs/03-analysis/code-review-2026-05-29.md`
- 메모리: [[feedback-ux-constraints]] [[project-data-model]] [[project-overview]]

## 1. 요약

제품 마스터(`products.jsx`)의 잉크 1·2·3도 슬롯을 **자유 텍스트 + datalist** 에서 **마스터 등록 잉크만 고를 수 있는 검색 선택기(포털 팝오버)** 로 교체했다. 이로써 잉크명 입력단의 마지막 자유 입력처를 막아 "유령 잉크"가 입력 시점에 생기는 것을 차단한다. 직전 라운드의 "마스터 정합성 검증 페이지(사후 검출)"와 짝을 이뤄 정합성 사이클을 닫는다.

- 새 순수 함수: `DataService.buildInkMaster(data)`, `isInkInMaster(name, master)`
- `InkSlotInput` 내부를 제약 선택기로 업그레이드 (호출부 변경 0 — products 2곳 + review 1곳 자동 적용)
- 신규 단위 테스트: buildInkMaster/isInkInMaster (전체 JS 60/60 통과)
- 영향받은 데이터 모델: **0** (입력 UX만 제약, 저장 형식 동일)

## 2. 작업 내역 (PDCA 단계별)

| Phase | 산출물 | 비고 |
|---|---|---|
| Plan | `docs/01-plan/잉크-cascade-선택.md` | 입력처 전수 점검 → products.jsx만 자유입력 잔존 식별, 도메인 규칙 확정 |
| Design | `docs/02-design/잉크-cascade-선택.md` | **Plan 대비 방향 조정**: 신규 `InkMasterPicker` 대신 기존 `InkSlotInput` 내부 업그레이드 |
| Do | `data-service.js`, `pages/products.jsx`, `pages/review.jsx`, `styles.css`, `tests/` | 커밋 `83ada2a` (WIP — Iterate/QA/Report 미완 상태로 중단) |
| Check | 브라우저 QA(zero-script) + `code-analyzer` 회귀 리뷰 | 본 라운드에서 수행 — **SHIP** 판정 |
| Act | cascade 팝오버 스크롤 추종 Minor 픽스 | 커밋 `3555810` |
| Report | 본 문서 | PDCA 사이클 종료 |

## 3. 핵심 변경

### 순수 함수 (`data-service.js`)
```js
buildInkMaster(data) -> string[]        // machineAssignments + inkPlan + products[].inks 합집합,
                                        // 정규화(trim+lowercase) dedup, 첫 원형 유지, 정렬
isInkInMaster(name, master) -> boolean  // 정규화 비교
```
- `inkOfAssignment`의 `a.ink || a.product || a.name` 규칙 내장(순수 계층은 ui.jsx 비의존)
- review.jsx의 인라인 `allInks` 중복 로직도 이 함수로 일원화

### UI (`products.jsx` InkSlotInput)
- `<input list> + <datalist>` 제거 → `.input` 모양 버튼 트리거 + `ReactDOM.createPortal` 팝오버
- 팝오버: 검색 input(autoFocus) + 필터 목록(`.cascade-item`), Enter=첫 항목 선택, 결과 0건 시 "잉크 추가 및 관리에서 먼저 등록" 안내(생성 버튼 없음)
- 미등록 기존 값: 빨간 테두리 + "마스터 미등록" 표기 유지
- 닫기: Esc / 바깥 클릭 / 항목 선택

## 4. 검증 결과

### 단위 테스트
```
$ npm test   → JS 60/60 pass
$ python tests/storage_test.py → 5/5 pass
```
buildInkMaster: 빈/누락 데이터, 합집합 dedup, 정규화 dedup(첫 원형 유지), 정렬, 우선순위 / isInkInMaster: 정규화 매칭

### 브라우저 QA (zero-script)
- 제품 빠른추가 잉크 슬롯 클릭 → 팝오버 → "HSOUL" 검색(1건 필터) → 선택 시 슬롯에 `HSOUL(H)` 적용 + 팝업 닫힘 ✅
- 콘솔 에러 0 (경고 1건은 표준 Babel in-browser 경고)

### 코드 리뷰 (code-analyzer)
- Critical 0 · Major 0 · 비차단 Minor 2 · 판정 **SHIP** (`code-review-2026-05-29.md`)

## 5. Plan/Design 대비 Gap 분석

| 항목 | 결과 | 비고 |
|---|---|---|
| products 잉크 슬롯 자유 타이핑 차단 | ✅ | 버튼 트리거 + 포털 선택기, value 입력 경로 없음 |
| 미등록 검색 시 등록 유도 안내 | ✅ | `.cascade-empty` 안내(생성 버튼 없음) |
| 기존 미등록 값 표시 + 빨간 표기 | ✅ | `isUnknown` 시각 규칙 계승 |
| 빈 데이터 안전(`buildInkMaster([])→[]`) | ✅ | 단위 테스트 커버 |
| 기존 인라인 allInks 와 동일 결과(회귀) | ✅ | review.jsx 동일 로직 일원화 |
| 단위 테스트 + 기존 회귀 없음 | ✅ | 60/60 |
| 제품 추가/수정 저장 정상 | ✅ | QA에서 cascade 선택 적용 확인 |

**방향 조정(Plan→Design, gap 아님)**: Plan은 신규 `InkMasterPicker`(ui.jsx) 추가였으나, `InkSlotInput`이 products(2)+review(1)에서 동일 의미로 쓰이고 props가 이미 적합해 **내부 업그레이드**로 변경 → 호출부 변경 0.

**Design 초과 달성**: Design §3은 "스크롤 오프셋 계산 불필요"로 보았으나, 리뷰에서 표 스크롤 시 `position:fixed` 팝오버가 트리거와 분리되는 Minor를 발견 → scroll(capture)·resize 리스너로 추종 추가(브라우저 검증: 200px 스크롤 시 -200px 추종). 원 설계보다 견고.

**Match Rate 추정: ≥ 95%** — 모든 성공 기준 충족, 추가 iterate 불필요.

## 6. 후속 작업 (향후 신규 PDCA 후보)

- **#3 안정 id 도입**: `testInks`/`products` 등 비고유 `name`을 PK로 쓰는 영역에 고유 id + 데이터 마이그레이션. (이번 하드닝에서 편집 오대상은 name 기준으로 임시 봉합, 근본 해결은 별도 플랜 권장)
- **machines 호기명 datalist 제약**: cascade 정책을 호기명 입력에도 확대(이번 스코프 외).
- **잉크 소진일 예측 / 발주 이력 보관**: 약품요청서 보고서의 후속 후보 유지.

## 7. 변경 파일 목록

```
A docs/01-plan/잉크-cascade-선택.md
A docs/02-design/잉크-cascade-선택.md
A docs/03-analysis/잉크-cascade-선택-report.md   (본 문서)
M data-service.js   (buildInkMaster, isInkInMaster + export)
M pages/products.jsx (InkSlotInput 제약 선택기 + 스크롤 추종, allInks→buildInkMaster)
M pages/review.jsx   (allInks→buildInkMaster 일원화)
M styles.css         (.ink-picker__pop)
M tests/data-service.test.js (buildInkMaster/isInkInMaster 테스트)
M app.jsx            (APP_REV 50→51)
```

관련 커밋: `83ada2a`(cascade WIP) → `3555810`(스크롤 추종 픽스 + 리뷰 SHIP, 마무리)
