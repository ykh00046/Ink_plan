# 완료 보고서 — 페이지 순수 로직 → data-service.js 추출 (R3-1순위)

- 기능 키: `data-service-추출`
- 완료일: 2026-06-01
- PDCA: Plan ✅ → Design ✅ → Do ✅ → Check ✅(100%) → Report ✅
- 문서: [01-plan](./01-plan.md) · [02-design](./02-design.md) · [03-analysis](./03-analysis.md)

## 1. 요약

bkit 종합 분석 R3 **1순위(거대 페이지 파일 비즈니스 로직 분리)** 완료. 3개 거대 페이지 파일에 갇혀 있던 **순수 파생 함수 16개**를 `data-service.js`로 단일화하고, 페이지는 `DataService.*` 위임 alias로 전환. 테스트 불가 영역을 해소하여 **신규 25개 단위 테스트**로 커버.

> 이전 세션(wip 53f37e8)에서 함수 이전 + ui.jsx 위임까지 진행됐으나 페이지 inline 정의가 중복 잔존한 미완료 상태였음. R3에서 D3(페이지 alias 교체)·테스트·검증을 마쳐 사이클 종결.

## 2. 변경 내역

### 코드
- **pages/ink-plan.jsx** (857→659): 파생 엔진 9함수 정의 → DataService alias
- **pages/review.jsx** (960→770): OCR/매칭 6함수 정의 → DataService alias
- **pages/inventory.jsx** (968→948): `invInkLifeInfo` → `DataService.inkLifeInfo` alias
- **data-service.js** (1123): 16함수 export (이전 세션 이전분, self-contained)
- **ui.jsx**: normalize 4종(`normalizeProductName/Brand`·`dayFromDate`·`inkOfAssignment`) data-service 위임(이전 세션)

### 테스트
- **tests/extracted-logic.test.js** (신규, 276줄, 25케이스)
- **package.json**: `npm test`에 신규 테스트 파일 등록

## 3. 성과 지표

| 지표 | Before | After |
|------|--------|-------|
| 페이지 3파일 합계 | 2,785줄 | 2,377줄 (**-408**) |
| 테스트 가능 순수 함수 | 페이지 격리(0 테스트) | DataService 노출 + 25 테스트 |
| JS 단위 테스트 | 70 pass | **95 pass / 0 fail** |
| 데이터 모델 변경 | — | 없음(순수 리팩토링) |

## 4. 핵심 결정

- **alias 전략**: 페이지 정의 블록을 1줄 위임으로 교체 → 컴포넌트 내부 호출부 전부 무변경, 회귀 표면적 최소화
- **로직 동일성 검증 우선**: 추출본 vs 원본을 정규화 diff로 대조해 "주석/내부헬퍼명만 차이, 실행 로직 동일"을 확인 후 교체 — 브라우저 수동 QA 없이도 회귀 0 확신 근거 확보
- **self-contained data-service**: Node 테스트 가능하도록 의존 헬퍼를 data-service 내부로 내재화 (브라우저 글로벌 비의존)

## 5. 후속 권장 (R3 잔여)

1. **R3-2순위**: 요일/교대/층 매직 문자열 → `DAYS`/`SHIFTS`/`FLOORS` 상수 단일화
2. **R3-3순위**: `isInkInMaster`·`lintMasters`의 trim/toLowerCase 중복 → 단일 `normInk()` 유틸
3. UI 컴포넌트(InkPlanRow·ReviewTable) 분리 — DOM 의존, 별도 사이클

## 6. 검증 명령

```bash
npm test    # 95 pass / 0 fail
```
