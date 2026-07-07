# Design — 마스터 정합성 검증 페이지

작성일: 2026-05-27
선행 문서: `docs/01-plan/마스터-정합성.md`

## 1. DataService API

### 시그니처
```js
DataService.lintMasters(data) → LintResult
```

### LintResult
```ts
type Severity = 'error' | 'warn' | 'info';
type Category =
  | 'product-not-in-master'
  | 'product-no-inks'
  | 'ink-not-in-assignments'
  | 'ink-no-code'
  | 'ink-no-machine'
  | 'duplicate-ink-assignment'
  | 'orphan-ink-assignment';

interface Issue {
  category: Category;
  severity: Severity;
  label: string;     // 한국어 짧은 설명 ("잉크 품목코드 미입력")
  target: string;    // 화면 표시용 이름 (제품명/잉크명/'OLD' 등)
  detail: string;    // 추가 컨텍스트 (예: '3층 12호기 월/주', '중복 2건')
  navTo: 'products' | 'machines' | 'injection';
  key: string;       // category + ':' + target + ':' + detail
}

interface LintResult {
  summary: {
    total: number;
    byCategory: Record<Category, number>;
    bySeverity: { error: number; warn: number; info: number };
  };
  issues: Issue[];   // severity desc → category → target asc
}
```

### 알고리즘 (의사코드)
```
1. productInks = Map<product.name, inks[]>
   - inks 모두 빈 제품 → 'product-no-inks' 추가
2. assignments = Map<ink, [{code, machine}]>
   - 같은 ink 이름이 2회 이상 → 'duplicate-ink-assignment' 추가
   - 단일 항목에 code 비어있음 → 'ink-no-code'
   - 단일 항목에 machine 비어있음 → 'ink-no-machine'
3. injection 순회
   - productInks에 없는 제품명 (normalized) → 'product-not-in-master'
     (target=원본 제품명, detail='3층 12호기 월/주' 첫 발견 위치)
4. productInks 의 모든 inks에 대해
   - assignments에 없는 잉크 → 'ink-not-in-assignments'
5. assignments 의 모든 ink에 대해
   - 어떤 productInks에도 없는 잉크 → 'orphan-ink-assignment' (info)
6. severity 가중치(error=2, warn=1, info=0) desc, 같은 severity는 category asc, target asc 로 정렬
```

### 정규화
- 제품명 비교: `normalizeProductName` (ui.jsx) 와 동일 로직을 DataService 내부에 복제(또는 옵션 인자로 받아서 적용). **선택**: 인자 `(data, { normalize })` 로 받아 단위 테스트에서 정규화 없이도 검증 가능하게 한다.
- 잉크명 비교: `String(x).trim()` 만 적용 (대소문자/공백은 잉크 마스터에서 사용자가 직접 보존)

## 2. 페이지 구조 — `pages/data-quality.jsx`

### Component
```jsx
function DataQualityPage({ ctx })
```

### State
```js
const [expanded, setExpanded] = useState(new Set())  // category 집합
const [filter, setFilter] = useState('all')          // 'all' | severity
```

### useMemo
- `lint = DataService.lintMasters(data, { normalize: normalizeProductName })`
- `visibleIssues = filter === 'all' ? lint.issues : lint.issues.filter(...)`

### 레이아웃 (기존 ChemicalsPage 패턴 재사용)
```
page__head
  page__title-row
    좌: title "데이터 점검" + meta-chips (총 N건, error K, warn K, info K)
    우: 새로고침 (실제로는 자동, 데이터 의존 useMemo)
page__body
  category-grid: 7개 카드 (severity 색상 보더링 + count badge)
    - 클릭 시 expanded 토글
  issue-table: 펼친 카테고리들의 이슈 행 통합 표시
    | severity 배지 | 카테고리 | 항목 | 상세 | 이동 |
```

### 이동 인터랙션
- `<button onClick={() => ctx.setView(issue.navTo)}>` — 기존 NAV 클릭과 동일.
- 별도 hash/route 변경 없음 (현재 시스템에 router 없음).

### 빈 상태
- `lint.summary.total === 0`: 큰 체크아이콘 + "마스터 데이터가 깨끗합니다" 메시지

### 인쇄
- 이 페이지는 인쇄 미지원 (운영자 점검용). 인쇄 CSS 추가 안 함.

## 3. CSS 추가 사항

styles.css 에 다음 정도만 추가:
```css
.lint-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; margin-bottom: 16px; }
.lint-card { padding: 12px; border: 1px solid var(--ink-200); border-radius: var(--radius-md); cursor: pointer; transition: background 0.1s; }
.lint-card:hover { background: var(--ink-50); }
.lint-card.active { background: var(--brand-50); border-color: var(--brand-500); }
.lint-card.error { border-left: 3px solid var(--bad-500); }
.lint-card.warn  { border-left: 3px solid var(--warn-500); }
.lint-card.info  { border-left: 3px solid var(--info-600); }
.lint-card__label { font-size: 12px; color: var(--ink-700); margin-bottom: 4px; }
.lint-card__count { font-size: 22px; font-weight: 700; color: var(--ink-900); }
.lint-sev { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.lint-sev--error { background: var(--bad-100); color: var(--bad-600); }
.lint-sev--warn  { background: var(--warn-100); color: var(--warn-600); }
.lint-sev--info  { background: var(--info-100); color: var(--info-600); }
.lint-empty { display: grid; place-items: center; padding: 60px 20px; color: var(--ink-500); text-align: center; }
```

## 4. 등록 변경

| 파일 | 변경 |
|---|---|
| `data-service.js` | `lintMasters` 함수 + return export 1줄 |
| `pages/data-quality.jsx` | 신규 (~200 LOC) |
| `app.jsx` | NAV `마스터` 그룹에 항목 1줄 + view switch 1줄 |
| `index.html` | `<script src="pages/data-quality.jsx">` 1줄 |
| `styles.css` | 위 lint-* 클래스 추가 (~25줄) |
| `tests/data-service.test.js` | lintMasters 테스트 5+개 |

## 5. 영향 분석

- 데이터 모델 변경 없음 (read-only)
- 기존 페이지 동작 영향 없음
- 데이터 크기에 대한 성능: O(injection cells × ink list size + products + assignments). 실제 데이터(~수백 셀, ~수백 잉크) 기준 1ms 미만 예상
- 테스트: 단위 테스트는 normalize 함수 주입 가능하게 설계 → ui.jsx 의존 없이 동작

## 6. 검증 시점

- 데이터가 바뀔 때마다 자동 재집계 (useMemo)
- 페이지 진입 시 1회 집계 후 사용자가 마스터를 수정하고 돌아오면 즉시 반영
