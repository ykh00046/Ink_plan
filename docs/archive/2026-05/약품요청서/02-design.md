# Design — 약품요청서 페이지

관련 Plan: [`docs/01-plan/약품요청서.md`](../01-plan/약품요청서.md)
작성일: 2026-05-24

## 1. 컴포넌트 트리

```
ChemicalsPage (window.ChemicalsPage)
├── 페이지 헤더 (.page__head)
│   ├── 타이틀 + 메타칩 (총 잉크 / 총 세트 / 3F / 1F)
│   └── 액션 버튼 (인쇄 / 클립보드 복사)
├── 필터 행 (.page__body)
│   ├── 범위 preset Seg (오늘 / 이번주 / 차주월 / 사용자지정)
│   ├── 요일 체크박스 (사용자지정 일 때만 노출)
│   ├── 시프트 토글 Seg (주 / 야 / 전체)
│   └── 층 토글 Seg (3F / 1F / 전체)
├── Card (잉크 표)
│   └── table.tbl (품목코드 | 잉크명 | 사용 호기 | 3층 | 1층 | 총 | 비고)
└── 인쇄 전용 헤더 (.chem-print-header, 평소엔 display:none)
    제목 + 작성일 + 작성자 + 범위
```

화면 구조는 `InkAddPage`와 일관성 유지. 차이점:
- 품목코드 컬럼 추가
- 범위 선택 가능 (오늘/이번주/차주월 등)
- 인쇄 시 발주서 형식

## 2. DataService 추가 함수

### `aggregateChemicalRequest(data, opts)`

순수 함수. 사출계획 셀을 잉크별로 집계.

```js
aggregateChemicalRequest(data, {
  days: ['월','화','수','목','금','토','일'],   // 집계 대상 요일
  shifts: ['day', 'night'],                      // 집계 대상 시프트
  floors: ['3층', '1층'],                         // 집계 대상 층
})
// → [
//   { code: 'BC1499', ink: 'SOUL', machine: '14호기', f3: 6, f1: 0, total: 6, hasCode: true },
//   { code: '',       ink: 'NOVA', machine: '47호기', f3: 0, f1: 4, total: 4, hasCode: false },
//   ...
// ]  // total desc 정렬
```

**알고리즘**:
1. `products` 로 `productName → inks[]` Map 생성
2. `machineAssignments` 로 `inkName → {code, machine}` Map 생성
3. `data.injection[floor][machineIdx].schedule[day][shift]` 순회 (옵션에 맞는 것만)
4. 각 셀의 제품 → 잉크들을 꺼내서 `{ink: count}` 누적, 층별 분리
5. 결과 배열 + total desc 정렬

**에지 케이스**:
- 빈 셀: 건너뜀
- 잉크 미등록 제품: 결과 외부에 `unmappedProducts: Set` 부산물로 노출 (페이지에서 경고 표시)
- machineAssignments에 없는 잉크: code='', machine='', hasCode=false 로 포함
- `days` 가 `차주월` 포함하면 사출계획의 `schedule['차주월']` 까지 본다

### 시그니처 정합성 — 옵션 기본값

`opts` 누락/부분 누락 시 안전한 기본:
```js
days = ['월','화','수','목','금','토','일','차주월']  // 전체
shifts = ['day', 'night']
floors = Object.keys(data.injection || {})
```

## 3. 페이지 상태(state)

```js
const PRESETS = [
  { value: 'today',  label: '오늘',   compute: (today) => [today] },
  { value: 'week',   label: '이번주', compute: () => ['월','화','수','목','금','토','일'] },
  { value: 'next',   label: '차주월', compute: () => ['차주월'] },
  { value: 'all',    label: '이번주+차주월', compute: () => ['월','화','수','목','금','토','일','차주월'] },
  { value: 'custom', label: '사용자 지정' }, // days state로 직접 조작
];

const [preset, setPreset] = useState('week');
const [customDays, setCustomDays] = useState([]);
const [shifts, setShifts] = useState(['day', 'night']);
const [floors, setFloors] = useState(['3층', '1층']);
```

`days` 는 preset 에서 자동 계산. preset이 `custom` 일 때만 customDays 활성화.

## 4. 인쇄 동작

- `window.print()` 사용
- `@media print` 에서 `.page__actions`, `.filter-bar`, `.floor-tabs` 등은 이미 숨김 (기존 CSS 재사용)
- 신규 추가:
  ```css
  .chem-print-header { display: none; }
  @media print {
    .chem-print-header { display: block; margin-bottom: 8mm; }
    .chem-print-header h1 { font-size: 16pt; margin: 0 0 6pt; }
    .chem-print-header .meta { font-size: 10pt; color: #333; }
    .chem-filter-bar { display: none !important; }
  }
  ```

## 5. 라우팅 / 등록

- `app.jsx` NAV: `현장 공급` 그룹에 `{ id: 'chemicals', label: '약품요청서', icon: 'beaker' }` 추가 (ink-add 다음 위치)
- `app.jsx` view switch: `{view === 'chemicals' && <ChemicalsPage ctx={ctx} />}`
- `index.html`: `<script type="text/babel" src="pages/chemicals.jsx?v=1"></script>` 추가
- `chemicals.jsx`: 끝에 `window.ChemicalsPage = ChemicalsPage;`

## 6. 테스트 케이스 (tests/data-service.test.js 신규)

1. **빈 데이터**: `aggregateChemicalRequest({injection:{}, products:[], machineAssignments:[]})` → `[]`
2. **정상 집계**: 사출계획 2셀 + 제품 + machineAssignments 있을 때 코드/호기 매핑되어 row 출력
3. **잉크 미등록 제품**: `unmappedProducts` 에 포함
4. **코드 미입력 잉크**: 결과에 포함되지만 `hasCode: false`
5. **층 필터**: floors=['3층'] 만 줬을 때 1층 셀은 카운트 안 됨
6. **시프트 필터**: shifts=['day'] 일 때 야간 셀은 카운트 안 됨

## 7. 부작용 / 호환성

- 기존 데이터 모델 0 수정 (read-only 집계)
- 다른 페이지 영향 없음
- `migrateData` 변경 없음
- localStorage / file DB 영향 없음

## 8. UI 디테일 (한글 라벨/문구)

- 페이지 타이틀: **약품요청서**
- 인쇄 헤더: **잉크 발주 요청서**
- 미등록 코드 행 비고: `품목코드 미입력 — 마스터에서 등록 권장`
- 미등록 잉크 제품 경고: `잉크 미등록 제품 N건 (제품 마스터에서 잉크 등록 필요)`
- 빈 상태: `선택한 범위에 사출계획이 없어요. 범위를 넓혀보세요.`
