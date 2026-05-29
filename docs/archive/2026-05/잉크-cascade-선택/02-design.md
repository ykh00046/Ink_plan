# Design — 잉크 선택 제약(cascade) — 제품 마스터 잉크 슬롯

작성일: 2026-05-28
관련 Plan: `docs/01-plan/잉크-cascade-선택.md`

## 0. 설계 변경 요약 (Plan 대비)

Plan은 "새 컴포넌트 `InkMasterPicker` 추가 + 호출부 교체"였으나, 코드 탐색 후 **기존 `InkSlotInput` 내부를 제약된 선택기로 업그레이드**하는 방향으로 조정.

근거:
- `InkSlotInput` 은 **products.jsx(2곳) + review.jsx(1곳)** 에서 동일 의미("제품에 잉크 배정")로 사용 중.
- props 인터페이스 `{ value, suggestions, onChange, placeholder }` 가 이미 필요한 그대로.
- 내부만 바꾸면 **호출부 변경 0, 검수 신규제품 등록 흐름도 자동 적용**.
- 전역 함수 선언이라 렌더 시점 해석 → 기존 cross-page 사용 패턴 그대로 안전.

## 1. 변경 파일

| 파일 | 변경 |
|---|---|
| `data-service.js` | `buildInkMaster(data)`, `isInkInMaster(name, master)` 추가 + export |
| `pages/products.jsx` | 인라인 `allInks` → `DataService.buildInkMaster(data)`; `InkSlotInput` 내부를 제약 선택기로 교체 |
| `pages/review.jsx` | 인라인 `allInks` → `DataService.buildInkMaster(data)` (로직 동일, dedup) |
| `styles.css` | 잉크 선택기 팝오버 클래스 추가(`cascade-*` 재사용 + 컨테이너 1종) |
| `tests/data-service.test.js` | buildInkMaster/isInkInMaster 테스트 |

## 2. 순수 함수 (data-service.js)

```js
// 잉크 마스터(정본 목록): machineAssignments + inkPlan + products[].inks 합집합.
// 정규화(trim+lowercase) 후 dedup, 표시명은 첫 발견 원형 유지, 정렬 반환.
function buildInkMaster(data) {
  const map = new Map();
  const add = (raw) => {
    if (!raw) return;
    const norm = String(raw).trim().toLowerCase();
    if (norm && !map.has(norm)) map.set(norm, raw);
  };
  const d = data || {};
  for (const a of (d.machineAssignments || [])) add(a && (a.ink || a.product || a.name));
  for (const i of (d.inkPlan || [])) add(i && i.name);
  for (const p of (d.products || [])) for (const ink of ((p && p.inks) || [])) add(ink);
  return Array.from(map.values()).sort();
}

function isInkInMaster(name, master) {
  const norm = String(name || '').trim().toLowerCase();
  if (!norm) return false;
  return (master || []).some(m => String(m || '').trim().toLowerCase() === norm);
}
```
- `inkOfAssignment`(ui.jsx) 의 `a.ink || a.product || a.name` 규칙을 내장(순수 계층은 ui.jsx 의존 불가).
- export 목록에 두 함수 추가.

## 3. 컴포넌트: 업그레이드된 InkSlotInput (products.jsx)

### Props (불변)
```
{ value: string|null, onChange: (v|null)=>void, suggestions: string[], placeholder: string }
```

### 상태/동작
- `open` (팝오버 표시), `q` (검색어), `pos` (portal 좌표)
- 트리거 = `.input` 모양 버튼. 클릭 시 `getBoundingClientRect()` 로 `pos` 계산 후 `open=true`.
- 팝오버는 `ReactDOM.createPortal(..., document.body)`, `position: fixed`, `top=rect.bottom+4, left=rect.left, width=rect.width` (스크롤 오프셋 계산 불필요).
- 팝오버 내부:
  - 검색 `<input autoFocus>` (q)
  - 필터 목록: `suggestions.filter(substr(q))` → `.cascade-item` 버튼들
  - 항목 클릭 → `onChange(ink); close()`
  - **Enter → 필터된 첫 항목 선택**(엑셀식 빠른 입력감)
  - 결과 0건 → `.cascade-empty`: "‘{q}’ 잉크가 마스터에 없습니다. [잉크 추가 및 관리]에서 먼저 등록하세요." (생성 버튼 없음)
- 닫기: Esc, 바깥 클릭(document mousedown 리스너, open일 때만 등록 → cleanup), 항목 선택.
- X(비우기) 버튼: value 있을 때 트리거 우측, `onChange(null)`.
- **미등록 표기 유지**: `value` 가 있으나 `suggestions` 에 없으면(`normalizeInkName` 비교) 트리거 빨간 테두리 + "마스터 미등록" 힌트. (기존 시각 규칙 계승)

### 제거되는 것
- `<input list>` + `<datalist>` (자유 텍스트 입력 경로 제거)
- `onChange(e.target.value)` 자유 타이핑 경로

### 불변식
- 사용자는 **목록에 있는 잉크만 선택** 가능 → 유령 잉크 입력 원천 차단.
- 신규 잉크 필요 시 안내만(ink-add.jsx로 유도) — [[feedback-ux-constraints]].

## 4. 접근성/UX 세부

- 트리거 `role`/포커스: 일반 button, 키보드 포커스 가능.
- 팝오버 열릴 때 검색 input autofocus.
- Esc → 닫고 트리거로 포커스 복귀(가능하면).
- 바깥 클릭 닫힘은 mousedown 기준(클릭 항목 onClick 보다 먼저 닫히지 않도록 팝오버 내부 클릭은 무시).
- 빈 마스터(suggestions=[]) → 팝오버에 "등록된 잉크 없음" + 등록 유도.

## 5. styles.css

기존 `.cascade-list`, `.cascade-item`, `.cascade-empty` 재사용. 신규 1종:
```css
.ink-picker__pop {            /* portal 팝오버 컨테이너 */
  position: fixed; z-index: 1000;
  background: var(--surface, #fff);
  border: 1px solid var(--ink-200);
  border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.12);
  padding: 8px; max-height: 320px; display: flex; flex-direction: column; gap: 6px;
}
.ink-picker__trigger { /* .input 위에 좌측 텍스트/우측 X 정렬 */ }
```
(실제 변수명은 styles.css 기존 토큰에 맞춰 적용)

## 6. 테스트 (tests/data-service.test.js)

`buildInkMaster`:
1. 빈/누락 데이터 → `[]`
2. machineAssignments + inkPlan + products.inks 합집합 dedup
3. 정규화 dedup(대소문자/공백 차이 → 1개, 첫 원형 유지)
4. 정렬 순서
5. `a.ink || a.product || a.name` 우선순위
6. (회귀) 기존 products.jsx 인라인 allInks 와 동일 결과

`isInkInMaster`:
7. 정규화 매칭 true / 미존재 false / 빈 입력 false

## 7. 검증 포인트 (QA)

- 제품 추가(빠른 추가) 잉크 슬롯 클릭 → 팝오버 → 검색 → 선택 → 저장
- 제품 수정 모달 동일
- 검수(OCR) 신규제품 등록 모달 잉크 슬롯도 동일 동작(자동 적용 확인)
- 자유 타이핑 불가 확인(목록 외 입력 경로 없음)
- 기존 미등록 잉크 보유 제품 표시 깨짐 없음
- 기존 14개 단위 테스트 회귀 없음
