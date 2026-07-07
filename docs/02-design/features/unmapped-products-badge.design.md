# Design — 마스터 정합성 전역 경고 배지 (unmapped-products-badge)

> PDCA Design · 2026-06-01 · Plan: `docs/01-plan/features/unmapped-products-badge.plan.md`

## 1. 설계 원칙

- **데이터 단일 출처**: 배지 카운트는 반드시 기존 `DataService.lintMasters()`에서 파생.
  data-quality 페이지와 100% 동일 수치 보장 (별도 계산 금지).
- **순수 함수 경계**: app.jsx에 분기 로직을 흩지 않고, 표시 모델을 만드는
  `buildMasterHealthBadge()`를 data-service.js에 추가해 Node 테스트 가능하게.
- **죽은 UI 활성화**: 헤더 bell 버튼은 현재 무동작 → 의미 있는 동작 부여.

## 2. 신규 순수 함수 (data-service.js)

```js
// 마스터 정합성 요약(lintMasters().summary) → 전역 경고 배지 표시 모델.
// 순수 함수, 부수효과 없음. error 심각도(제품 마스터를 손봐야 하는 결함)만 배지화.
function buildMasterHealthBadge(lintSummary) {
  const s = lintSummary || {};
  const bySeverity = s.bySeverity || {};
  const byCategory = s.byCategory || {};
  const errorCount  = bySeverity.error || 0;
  const notInMaster = byCategory['product-not-in-master'] || 0;  // 마스터에 없는 제품
  const noInks      = byCategory['product-no-inks'] || 0;        // 잉크 비어있는 제품
  const show = errorCount > 0;
  const parts = [];
  if (notInMaster > 0) parts.push(`마스터에 없는 제품 ${notInMaster}건`);
  if (noInks > 0)      parts.push(`잉크 미등록 제품 ${noInks}건`);
  const tooltip = show
    ? `데이터 점검 필요 — ${parts.join(' · ')}`
    : '마스터 데이터 정상';
  return { errorCount, notInMaster, noInks, show, tooltip };
}
```

- export 목록에 `buildMasterHealthBadge` 추가.
- **입력 계약**: `lintMasters(data, {normalize}).summary` 형태. null/누락 필드 방어.
- **error만 배지화하는 이유**: warn/info(중복 등록, 코드 미입력 등)는 발주 누락을
  유발하지 않음. 상시 빨간 배지는 "지금 안 고치면 누락되는" error에 한정해 알람 피로 방지.

## 3. App 통합 (app.jsx)

### 3.1 파생 계산 (App 함수 본문, data 로드 이후)
```js
const masterHealth = useMemo(() => {
  const lint = DataService.lintMasters(data, { normalize: normalizeProductName });
  return DataService.buildMasterHealthBadge(lint.summary);
}, [data]);
```
- `data` 의존 메모이즈. 로드 순서상 `DataService`·`normalizeProductName` 평가 보장.

### 3.2 사이드바 "데이터 점검" 배지
기존 products/test-inks 배지 라인 옆에 추가:
```jsx
{item.id === 'data-quality' && masterHealth.show && (
  <span className="sb-item__badge sb-item__badge--alert" title={masterHealth.tooltip}>
    {masterHealth.errorCount}
  </span>
)}
```

### 3.3 헤더 bell 버튼 활성화
```jsx
<button
  className="app__chip"
  title={masterHealth.tooltip}
  onClick={() => masterHealth.show && setView('data-quality')}
  style={masterHealth.show ? { background: 'var(--bad-100, oklch(0.95 0.05 25))', borderColor: 'var(--bad-600, oklch(0.55 0.18 25))', color: 'var(--bad-600, oklch(0.55 0.18 25))' } : null}
>
  <Icon name="bell" size={12} />
  {masterHealth.show && <span style={{ marginLeft: 4, fontWeight: 700 }}>{masterHealth.errorCount}</span>}
</button>
```
- error 0건이면 기존과 동일(중립, 무동작 유지) → 시각 노이즈 없음.

## 4. 스타일 (styles.css)

`sb-item__badge--alert` 추가 — 기존 `.sb-item__badge` 베이스 + 빨강 톤 오버라이드:
```css
.sb-item__badge--alert { background: var(--bad-100, oklch(0.95 0.05 25)); color: var(--bad-600, oklch(0.55 0.18 25)); }
.sb-item.active .sb-item__badge--alert { background: var(--bad-100, oklch(0.95 0.05 25)); color: var(--bad-600, oklch(0.55 0.18 25)); }
```
- **변수 실태 반영**: `:root`에 `--bad-100`·`--bad-600`만 정의됨(`--bad-50/300/700` 미정의).
  따라서 bell 인라인·배지 모두 **존재하는 `--bad-100`/`--bad-600` 사용 + fallback 동봉**으로 통일.
- 변수 누락 대비 fallback은 chemicals.jsx 인라인 경고와 동일 관행.

## 5. 테스트 (tests/data-service.test.js)

`buildMasterHealthBadge` 단위 테스트 추가:

| 케이스 | 입력 summary | 기대 |
|--------|-------------|------|
| 결함 없음 | `{bySeverity:{error:0,...}, byCategory:{}}` | `show=false`, tooltip='마스터 데이터 정상' |
| 마스터 누락만 | `{bySeverity:{error:2}, byCategory:{'product-not-in-master':2}}` | `show=true, errorCount=2, notInMaster=2`, tooltip에 '마스터에 없는 제품 2건' |
| 복합(누락+잉크빔) | error:3, not-in-master:1, no-inks:2 | tooltip='…마스터에 없는 제품 1건 · 잉크 미등록 제품 2건' |
| null 방어 | `undefined` | `show=false`, 예외 없음 |
| lintMasters 연동 | 실제 data로 lintMasters→summary→badge | errorCount === summary.bySeverity.error |

## 6. 구현 순서

1. data-service.js: `buildMasterHealthBadge` 추가 + export
2. tests/data-service.test.js: 단위 테스트 추가 → `node --test` GREEN
3. app.jsx: useMemo 파생 + 사이드바 배지 + bell 버튼
4. styles.css: `.sb-item__badge--alert`
5. 전체 테스트 회귀 확인 + 수동 확인(데이터 점검 페이지 수치와 배지 일치)

## 7. 영향 범위

| 파일 | 변경 |
|------|------|
| data-service.js | 함수 1개 추가 + export (순수, 기존 동작 불변) |
| app.jsx | useMemo 1개 + JSX 2곳 |
| styles.css | 클래스 1개 |
| tests/data-service.test.js | 테스트 5케이스 |

기존 함수 시그니처 변경 없음 → 회귀 위험 최소.
