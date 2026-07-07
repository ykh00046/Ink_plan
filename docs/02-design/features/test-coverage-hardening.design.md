# Design — 테스트 공백 보강 (test-coverage-hardening)

> PDCA Phase: **Design** · 작성일 2026-06-01 · Plan: `test-coverage-hardening.plan.md`

## 1. 설계 개요

3개 영역을 각각 다른 전략으로 보강한다. 핵심 원칙: **동작 보존 + 진짜 공백만**.

```
영역 A: cascade 선택 로직   → 순수 추출(data-service.js) + ui.jsx 위임 + JS 테스트
영역 B: server.py 가드      → 핸들러 단위 테스트(소켓 우회) 신설 server_test.py
영역 C: 재고 lot 변형 엣지   → ui-regressions.test.js 엣지케이스 추가
```

## 2. 영역 A — cascade 순수 함수 추출

### 현재 (ui.jsx CascadePicker, 인라인 useMemo)
```js
brands          = [...new Set(products.filter(p=>p.brand).map(p=>p.brand))].sort()
productsInBrand = products.filter(p => p.brand === brand)         // brand 없으면 []
inksInProduct   = (products.find(x=>x.name===name)?.inks||[]).filter(Boolean)  // name 없으면 []
visible*        = q ? items.filter(name/label.toLowerCase().includes(q)) : items
```

### 추출 대상 (data-service.js, 순수 함수)
| 함수 | 시그니처 | 동작 |
|------|----------|------|
| `buildCascadeBrands(products)` | `(Array)→ string[]` | `p.brand` 있는 것만 Set dedup 후 정렬 |
| `cascadeProductsInBrand(products, brand)` | `(Array, string)→ Product[]` | `brand` falsy면 `[]`, 아니면 `p.brand===brand` 필터 |
| `cascadeInksInProduct(products, name)` | `(Array, string)→ string[]` | `name` falsy면 `[]`, 제품의 `inks` 중 truthy만 |
| `filterByQuery(items, query, keyFn)` | `(Array, string, fn)→ Array` | query trim/소문자, `keyFn(item).toLowerCase().includes(q)`; 빈 query면 원본 |

### ui.jsx 위임 (동작 보존 — 로직 이동만)
```js
const brands          = React.useMemo(() => DataService.buildCascadeBrands(products), [products]);
const productsInBrand = React.useMemo(() => DataService.cascadeProductsInBrand(products, brand), [brand, products]);
const inksInProduct   = React.useMemo(() => DataService.cascadeInksInProduct(products, productName), [productName, products]);
const visibleBrands   = React.useMemo(() => DataService.filterByQuery(brands, brandSearch, b => b), [brands, brandSearch]);
const visibleProducts = React.useMemo(() => DataService.filterByQuery(productsInBrand, productSearch, p => p.name), [productsInBrand, productSearch]);
```
→ React import/Hook 순서·의존성 배열 불변, 반환값 동일 → 회귀 위험 최소.

### 테스트 (data-service.test.js 신규 섹션)
- brands: brand 없는 제품 제외 / dedup / 정렬 / 빈 입력 `[]`
- productsInBrand: brand 매칭 / 빈 brand → `[]` / 미존재 brand → `[]`
- inksInProduct: 제품 잉크 truthy 필터 / 빈 name → `[]` / 미존재 name → `[]`
- filterByQuery: 부분일치(대소문자 무시·trim) / 빈 query 원본 / keyFn 적용

## 3. 영역 B — server.py 가드 단위 테스트 (`tests/server_test.py`)

### 테스트 더블 전략
`Handler.__new__(Handler)`로 `__init__`(소켓 바인딩) 우회 → `headers`(dict) / `path`(str)만 주입.
가드 메서드는 `self.headers.get(...)`·`self.path`만 읽으므로 안전. (Plan 단계에서 실증 완료.)

### `is_api_request_allowed` 케이스
| 케이스 | headers | 기대 |
|--------|---------|------|
| 로컬 Host, Origin 없음 | `Host=127.0.0.1:8765` | True |
| 로컬 Host(localhost) | `Host=localhost` | True |
| 외부 Host (DNS rebinding) | `Host=evil.com` | **False** |
| Host 없음(빈) + Origin 없음 | `{}` | True (host falsy면 통과 — 기존 동작 명문화) |
| 로컬 Host + 동일출처 Origin | `Origin=http://127.0.0.1:8765` | True |
| 로컬 Host + 외부 Origin (CSRF) | `Origin=http://evil.com` | **False** |
| 로컬 Host + localhost Origin | `Origin=http://localhost:8765` | True |

### `is_blocked_static` 케이스
| path | 기대 |
|------|------|
| `/data/db/current.json` | True |
| `/data/backups/x.json` | True |
| `/data/settings.json` | True |
| `/index.html` / `/app.jsx` | False |
| `/DATA/DB/current.json` (대문자 우회) | True (소문자화 방어) |
| `/data%2fdb/current.json` (인코딩 우회) | True (unquote 방어) |

## 4. 영역 C — 재고 lot 변형 엣지케이스 (`ui-regressions.test.js` 추가)

기존 happy-path를 보완하는 엣지만 추가 (중복 금지):
| 테스트 | 검증 대상 | 포인트 |
|--------|-----------|--------|
| relabel 자식 lot까지 cascade 삭제 | `removeInventoryLot` | `parentId===lotId`인 relabel 행도 함께 제거, daily에서도 제거 |
| `order` 배열 보존/정리 | `removeInventoryLot` | `inv.order` 있으면 제거 id 빼고 유지 |
| 미존재 lotId 제거는 무변동(idempotent) | `removeInventoryLot` | 없는 id → lots/daily 동일 |
| null/undefined inventory 안전 | `removeInventoryLot`/`removeInventoryInk` | 빈 구조 반환, throw 없음 |
| relabel order>3 상한 | `relabelInventoryLot` | 3개째 이후 relabel 시 inv 변동 없음 |

## 5. 실행 진입점 갱신

- `package.json` `test`: JS 3개 파일 유지 (cascade·lot 테스트는 기존 파일에 추가되므로 변경 불필요)
- Python: `python -m unittest discover -s tests -p "*_test.py"` 로 `storage_test.py`+`server_test.py` 동시 실행. README/CLAUDE.md 명령 참고용 1줄 보강.

## 6. 영향 범위 (codegraph 기준)
- `data-service.js`: 함수 4개 추가 + export 4줄 → 순수 추가, 기존 export 불변
- `ui.jsx`: CascadePicker 5개 useMemo 본문만 위임으로 교체 → 외부 계약 동일
- 신규 파일 1개(`tests/server_test.py`), 테스트 파일 2개 수정

## 7. 다음 단계
→ 구현(Do) → 테스트 실행(Iterate) → QA → Report
