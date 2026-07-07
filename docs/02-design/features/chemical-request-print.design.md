# Design — 약품요청서 인쇄물 완성 (chemical-request-print)

> PDCA Design · 2026-06-08 · [[chemical-request-print]] Plan 기반

## 1. 아키텍처 개요

```
TweaksControls(app.jsx) ──set requester──▶ tweaks (영속) ──ctx.tweaks──▶ ChemicalsPage
                                                                              │
                              DataService.buildChemicalRequestMeta(...) ◀─────┤ (순수 코어)
                                                                              ▼
                                                          .chem-print-header (메타·문서번호)
                                                          .chem-approval (결재란, @media print)
```

단일 출처: 작성자 = `tweaks.requester`, 메타 산출 = `buildChemicalRequestMeta` 1곳.

## 2. 순수 코어 — `data-service.js`

```js
// 약품요청서 인쇄 메타 — 작성자 fallback·문서번호·요약·결재 roster를 한 곳에서 산출.
// todayISO는 주입(순수 유지). 데이터 변경 없음.
function buildChemicalRequestMeta(totals, rangeLabel, requester, todayISO) {
  const name = (requester && String(requester).trim()) || '생산관리팀';
  const ymd = (todayISO || '').replaceAll('-', '');   // 2026-06-08 → 20260608
  const docNo = ymd ? `약품-${ymd}` : '약품-미상';
  const t = totals || { kinds: 0, total: 0, f3: 0, f1: 0, noCode: 0 };
  const summary = `총 잉크 ${t.kinds}종 / 총 세트 ${t.total} (3F ${t.f3} · 1F ${t.f1})`;
  return {
    title: '잉크 발주 요청서',
    docNo,
    requesterName: name,
    rangeLabel: rangeLabel || '없음',
    summary,
    noCode: t.noCode || 0,           // 인쇄물에도 코드미입력 경고 노출용
    approvals: ['작성', '검토', '승인'],
  };
}
```

- `replaceAll` 사용(Node 15+/모던 브라우저 OK). 안전 위해 `.split('-').join('')` 대안 검토했으나 `replaceAll` 채택.
- export 추가: IIFE 반환 객체에 `buildChemicalRequestMeta` 노출.

### 입출력 계약

| 입력 | 처리 |
|---|---|
| `requester = '홍길동 (구매팀)'` | `requesterName = '홍길동 (구매팀)'` |
| `requester = ''` / `'  '` / `undefined` / `null` | `requesterName = '생산관리팀'` (fallback) |
| `todayISO = '2026-06-08'` | `docNo = '약품-20260608'` |
| `todayISO = ''`/`undefined` | `docNo = '약품-미상'` |
| `totals = {kinds:3,total:42,f3:30,f1:12,noCode:1}` | `summary='총 잉크 3종 / 총 세트 42 (3F 30 · 1F 12)'`, `noCode=1` |
| `totals = null` | 0-fallback, summary='총 잉크 0종 / 총 세트 0 (3F 0 · 1F 0)' |

## 3. `chemicals.jsx` 변경

1. `ctx`에서 `tweaks` 수신: `const { data, notify, today, tweaks } = ctx;`
2. 메타 산출:
   ```js
   const meta = useMemo(
     () => DataService.buildChemicalRequestMeta(totals, rangeLabel, tweaks && tweaks.requester, todayISO),
     [totals, rangeLabel, tweaks, todayISO]
   );
   ```
3. `.chem-print-header` 교체 — 하드코딩 제거:
   ```jsx
   <div className="chem-print-header">
     <h1>{meta.title}</h1>
     <div className="meta">
       <div>문서번호: {meta.docNo}</div>
       <div>작성일: {todayISO}</div>
       <div>작성자: {meta.requesterName}</div>
       <div>출력 시각: {printedAt}</div>
       <div>대상 범위: {meta.rangeLabel}</div>
       <div>{meta.summary}</div>
     </div>
   </div>
   ```
4. 표 카드 뒤(`page__body` 내, Card 다음)에 결재란 추가 — 평소 숨김:
   ```jsx
   <div className="chem-approval">
     {meta.approvals.map(role => (
       <div className="chem-approval__box" key={role}>
         <div className="chem-approval__role">{role}</div>
         <div className="chem-approval__sign"></div>
       </div>
     ))}
   </div>
   ```

## 4. `app.jsx` 변경

1. `TWEAK_DEFAULTS`에 기본값 추가: `requester: ''` (빈값 → 코어가 fallback 처리).
2. `TweaksControls`에 입력 추가 (기존 `TweakRadio`/`TweakToggle` 패턴 옆):
   ```jsx
   <TweakText label="발주 작성자" value={tweaks.requester || ''}
              placeholder="예: 김선명 (생산관리팀)"
              onChange={v => setTweak('requester', v)} />
   ```
   - `TweakText`가 tweaks-panel.jsx에 없으면 기존 컨트롤 재사용 또는 inline `<input>`로 대체(Do에서 확인).
3. `ctx`에 `tweaks` 이미 포함됨(app.jsx:270 확인) — 추가 배선 불필요.

## 5. `styles.css` 변경 (`@media print` 블록 내부 + 평소 숨김)

```css
/* 약품요청서: 결재란(평소 숨김, 인쇄 시만) */
.chem-approval { display: none; }

@media print {
  /* 기존 숨김 목록에 .chem-approval 제외(표시), 문서번호 등은 헤더가 처리 */
  .chem-approval {
    display: flex !important;
    gap: 0;
    margin-top: 8mm;
    page-break-inside: avoid !important;
  }
  .chem-approval__box {
    border: 0.5pt solid #000;
    width: 28mm; height: 22mm;
    display: flex; flex-direction: column;
  }
  .chem-approval__box + .chem-approval__box { border-left: 0; } /* 인접 테두리 합치기 */
  .chem-approval__role {
    font-size: 9pt; text-align: center;
    border-bottom: 0.5pt solid #000; padding: 2pt 0;
  }
  .chem-approval__sign { flex: 1; } /* 도장 공간 */
}
```

- 결재란은 표 **아래**(우측 정렬은 `margin-left:auto`로 박스 묶음 우측 배치 — Do에서 미세조정).
- 화면에서는 `.chem-approval { display:none }` → 회귀 0.

## 6. 테스트 — `tests/data-service.test.js`

`buildChemicalRequestMeta` 신규 테스트 5케이스:
1. 정상 작성자 → 그대로 반영 + docNo 포맷 + summary
2. 빈/공백 작성자 → `생산관리팀` fallback
3. `todayISO` 누락 → `약품-미상`
4. `totals=null` → 0 안전 처리
5. `approvals` = `['작성','검토','승인']` 고정 + `noCode` 전달 확인

## 7. 구현 순서

1. `data-service.js`: `buildChemicalRequestMeta` + export
2. `tests/data-service.test.js`: 5케이스 추가 → `npm test` GREEN 확인
3. `chemicals.jsx`: ctx.tweaks 수신 + meta useMemo + 헤더 교체 + 결재란 JSX
4. `app.jsx`: `TWEAK_DEFAULTS.requester` + `TweaksControls` 입력
5. `styles.css`: `.chem-approval` 화면 숨김 + `@media print` 스타일
6. `index.html`: data-service.js·chemicals.jsx·app.jsx·styles.css 캐시 버전 bump(통일)
7. QA(Playwright) → Gap Analysis → Report

## 8. 영향 범위 / 회귀 가드

| 변경 | 회귀 위험 | 가드 |
|---|---|---|
| 헤더 하드코딩 → meta | 헤더 표기 변화 | 작성일/출력시각/범위/요약 동일 유지, 작성자만 동적 + 문서번호 신설 |
| 결재란 JSX 추가 | 화면 레이아웃 변동 | `display:none` 기본 → 인쇄만. 스냅샷 회귀 0 |
| TWEAK_DEFAULTS 추가 | 기존 tweaks 파싱 | 키 추가는 비파괴(기존 useTweaks 머지) |
| 캐시 버전 bump | 구버전 캐시 잔존 | 4파일 동일 버전 통일 |
