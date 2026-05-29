# Plan — 잉크 선택 제약(cascade) — 제품 마스터 잉크 슬롯

작성일: 2026-05-28
작성자: 김선명(생산관리팀) — 단일 사용자 운영
관련 메모리: [[feedback-ux-constraints]] [[project-data-model]] [[project-overview]]
관련 선행 작업: `docs/03-analysis/마스터-정합성-report.md` (사후 검출 페이지)

## 1. 배경 / Problem

직전 라운드에서 "마스터 정합성 검증 페이지(Data Lint)"를 만들어 **이미 생긴** 데이터 결함(유령 잉크, 미등록 잉크 등)을 *사후 검출*한다. 그러나 결함이 **입력 시점에 생기는 것**을 막지는 못한다. 입력단을 막아야 정합성 사이클이 닫힌다.

코드 탐색 결과, 잉크명 입력/참조 지점의 현황은 다음과 같다:

| 위치 | 현재 방식 | 정책 부합? |
|---|---|---|
| 사출계획 `injection.jsx` | `CascadePicker` (브랜드→제품) | ✅ 제약됨 |
| 양산대응 `test-inks.jsx` | `CascadePicker` (브랜드→제품) | ✅ 제약됨 |
| 잉크계획 `ink-plan.jsx` | 잉크명 표시 전용(파생) | ✅ 입력 없음 |
| 잉크 추가 `ink-add.jsx` | 자유 입력(신규 생성) | ✅ 정책상 허용 |
| **제품 마스터 `products.jsx` 잉크 슬롯** | **자유 텍스트 + datalist** | ❌ **유령 잉크 가능** |
| 검수 `review.jsx` | OCR 브랜드/제품 정정용 input | ✅ OCR 정정 예외 |
| 호기 마스터 `machines.jsx` | 호기명 datalist | (별도 관심사) |

→ **유일하게 남은 잉크 자유 입력처는 `products.jsx`의 `InkSlotInput`** (제품에 1·2·3도 잉크 배정). 현재 `text + <datalist>` 이며, 미등록 잉크는 **빨간 테두리·저장 거부**로만 막는다(소프트). 사용자가 datalist를 무시하고 새 이름을 타이핑하면 화면상 입력은 되고, 저장 단계에서야 막힌다. 오타·표기 차이가 "마스터에 없는 잉크"로 흘러갈 여지가 있다.

## 2. 사용자 시나리오

> 김선명이 제품 마스터에서 신제품을 등록하거나 기존 제품의 잉크 구성을 바꾼다.
>
> 1. `마스터 > 제품` → 제품 추가(빠른 추가) 또는 기존 제품 수정
> 2. 잉크 1도 슬롯 클릭 → **잉크 마스터 목록이 검색 가능한 드롭다운으로 뜸**
> 3. 검색어 입력 → 마스터에 등록된 잉크만 필터링되어 보임
> 4. 클릭하여 선택 (자유 타이핑으로 신규 이름 생성 불가)
> 5. 원하는 잉크가 목록에 없으면 → "‘OOO’ 잉크가 마스터에 없습니다. [잉크 추가 및 관리]에서 먼저 등록하세요" 안내 (인라인 생성 불가)
> 6. 2·3도 슬롯도 동일

## 3. 도메인 규칙 (확정)

- **잉크 마스터(정본 목록)** = `machineAssignments`(정본) + `inkPlan` + 기존 `products[].inks` 의 합집합. 정규화(trim+lowercase) 후 dedup, 표시 이름은 첫 발견 원형 유지. (현재 `products.jsx` 인라인 `allInks` 로직과 동일 — 이를 순수 함수로 추출)
- **자유 텍스트 입력 금지**: 제품 잉크 슬롯에서 새 이름을 타이핑으로 만들 수 없다. 선택만 가능.
- **미등록 잉크 → 생성 유도 금지, 안내만**: 잉크 생성은 `ink-add.jsx`의 명시적 행동으로만. (실수 방지 — [[feedback-ux-constraints]])
- **비우기(X) 유지**: 슬롯을 비울 수 있어야 함(2·3도는 선택).
- **기존 값 호환**: 이미 저장된 제품이 마스터에 없는 잉크명을 갖고 있어도 표시는 되어야 하고, "미등록" 으로 시각 표기.

## 4. 입력 / 출력

### 새 순수 함수 (data-service.js)
```js
buildInkMaster(data) -> string[]   // 정렬된 고유 잉크 표시명 (machineAssignments+inkPlan+products.inks 합집합)
isInkInMaster(name, master) -> boolean  // 정규화 비교
```
- `buildInkMaster`는 `inkOfAssignment` 의 잉크 추출 규칙(`a.ink || a.product || a.name`)을 내장(순수 계층은 ui.jsx 의존 불가)
- 빈/누락 데이터(`null`, 빈 배열)에 안전

### 새 컴포넌트 (ui.jsx)
`InkMasterPicker` — 검색 가능한 단일 컬럼 잉크 선택기(팝오버)
```
props: { value, inks, onChange(value|null), placeholder }
```
- 버튼(현재값/placeholder) 클릭 → 팝오버(검색 input + 필터된 잉크 목록)
- 잉크 클릭 → onChange, 닫힘 / X → onChange(null)
- 검색 결과 없음 → "마스터에 없음 — 잉크 추가에서 등록" 안내
- 미등록 현재값 → 빨간 표기(기존 InkSlotInput 시각 규칙 계승)
- 팝오버는 portal(클리핑 회피, 기존 InkNameCell 패턴 따름), Esc/바깥 클릭 닫힘

### 교체 지점 (products.jsx)
- 빠른 추가 행의 `InkSlotInput` 3슬롯 → `InkMasterPicker`
- `ProductEditor` 모달의 `InkSlotInput` 3슬롯 → `InkMasterPicker`
- 인라인 `allInks` useMemo → `DataService.buildInkMaster(data)` 사용
- `findUnknownInks` 저장 가드는 유지(이중 안전망)

## 5. 범위 (Scope)

### IN
- `data-service.js`: `buildInkMaster`, `isInkInMaster` 추가 + export
- `ui.jsx`: `InkMasterPicker` 컴포넌트 + window 노출 + 필요한 styles.css 클래스
- `products.jsx`: 잉크 슬롯 2곳 교체, allInks → buildInkMaster
- `tests/data-service.test.js`: buildInkMaster/isInkInMaster 단위 테스트 5+개
- 기존 `InkSlotInput` 제거(사용처 없어지면) 또는 보존 판단

### OUT
- 사출/잉크계획 cascade — 이미 적용됨(작업 불필요)
- 호기명(machines.jsx) datalist 교체 — 별도 관심사, 이번 스코프 외
- 검수(review.jsx) OCR 정정 input — OCR 예외, 유지
- 잉크 인라인 생성 — 정책상 금지(ink-add.jsx로 유도)

## 6. 성공 기준

1. 제품 마스터 잉크 슬롯에서 **자유 타이핑으로 신규 잉크명 생성 불가** (선택만)
2. 마스터에 없는 잉크 검색 시 "등록 유도" 안내 표시
3. 기존에 저장된 미등록 잉크 값도 깨짐 없이 표시 + "미등록" 시각 표기
4. 빈 데이터에서 충돌 없이 동작 (buildInkMaster([]) → [])
5. `buildInkMaster` 결과가 기존 인라인 allInks 와 동일(회귀 없음)
6. 단위 테스트 통과 + 기존 14 테스트 회귀 없음
7. 제품 추가/수정 저장 정상 동작

## 7. 위험 / 미정 사항

- `InkSlotInput` 을 다른 곳에서도 쓰는지 확인 필요(`window.InkSlotInput` 노출됨) — 교체 전 사용처 점검.
- 팝오버 portal의 위치 계산은 기존 InkNameCell 패턴 재사용으로 위험 최소화.
- 잉크 마스터가 큰 경우(수백 개) 검색 필터 성능 — 단일 사용자·목록 수백 수준이라 무시 가능, 필요 시 가상화는 후순위.
