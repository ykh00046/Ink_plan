# 사출계획 제품 정체성(id) 기반 매칭 Design Document

> **Summary**: 같은 이름 제품(액상/분말, 동명 다른제품)을 끝까지 정확히 가리키도록 **제품에 안정적 id를 부여**하고, 사출계획 셀이 이름 대신 id를 들고 다니게 한다. 정체성은 사람이 매칭을 확정하는 review 순간에 못박는다.
>
> **Project**: ink-plan
> **Date**: 2026-06-19
> **Status**: Draft (승인됨 — 구현 대기)
> **이력**: 초안은 문자열 "(액상)" 인코딩(Option A)이었으나, 데이터 검증에서 같은 이름·같은 제형·다른 잉크(`U-buding`)가 발견되고 "정상 동명 8종 합치면 안 됨" 정책과 충돌 → **id 기반으로 전환**.

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 이름이 같은 제품이 여럿(액상/분말 6쌍 + 동명 다른제품 U-buding 등)이라 **이름만으론 어느 제품인지 못 가린다.** 틀린 제품 → 틀린 잉크 → 소요량·넣어줄잉크·가용일 오류. |
| **WHO** | 사출계획 OCR을 올리고 잉크계획을 보는 생산관리 담당자 |
| **RISK** | injection 셀 모양 변경이 셀을 읽는 다수 화면에 파급. 마이그레이션 id 안정성. |
| **SUCCESS** | 동명 충돌이 있어도 review에서 한 번 고른 그 제품이 끝까지 유지 / 화면은 이름 그대로 표시 / 레거시 데이터 무탈 / 테스트 통과 |
| **SCOPE** | 제품 id 부여·마이그레이션, injection 셀 id화(하위호환), 해소/표시 헬퍼, OCR 캡처, 제품 CRUD id 보존, 테스트 |

---

## 1. 문제: 이름은 정체성이 아니다 (근거)

현재 제품은 **이름으로 식별**된다(제품에 id 없음, 0/655). 그런데 마스터엔 같은 이름이 8종 공존:

| 분류 | 수 | 예 | 이름으로 구분? |
|---|---|---|---|
| 분말/액상(type 다름) | 6 | `D_Affogato_55% UV` 분말=AFFO+GATO / 액상=CONVEX+ESCAPE | △ 제형 알면 |
| 완전 중복(무해) | 1 | `Bella D_Pine` (잉크 동일) | — |
| **동명 다른제품(type도 같음)** | 1 | `U-buding` 둘 다 POWDER, 잉크 TICO+… vs GRAMPUS+… | **✗ 불가** |

정책상 "정상 동명 — 합치면 안 됨"이라 **같은 이름은 영구히 공존**하고, 제품은 계속 추가된다 → 동명 충돌은 늘어난다. 사출계획 셀이 **이름 문자열**만 저장하는 한, 하류(`resolveProductIn`)는 이름으로 후보를 못 좁혀 **먼저 걸리는 1건**을 찍는다(=틀림).

부수 확인: 제품 편집/삭제도 이름 키(`products.jsx` findIndex/filter by name)라 **동명 제품을 따로 못 고친다** — id가 함께 해결.

---

## 2. 설계: review에서 정체성을 못박아 id로 운반

```text
OCR rows: { machine_no, brand, variant, product_name }
   │
   ▼  review.jsx — 사람이 매칭 확정 (동명이면 여기서 1회 선택)
decision.target = 특정 마스터 제품  ──→  그 제품의 id
   │
   ▼  applyOcrToInjection
schedule[요일][shift] = { name: 제품명, id: 제품id }   ← 이름(표시) + id(정체성)
   │
   ▼  buildDemandByInkDay 등
resolveProductById(id)  → 정확히 그 제품 → 정확한 잉크
```

원칙:
- **정체성은 id, 표시는 이름.** 셀은 `{name, id}` (레거시 문자열도 계속 허용).
- 정체성 확정은 **review 1회**. 이후 자동 기억.
- 모든 셀 접근은 헬퍼 `productCellName(cell)` / `productCellId(cell)` 단일 출처로 — 독자 churn 최소화.
- id는 **표시 안 함**(내부용). 사용자는 id 존재를 몰라도 됨.

---

## 3. 사용자 흐름 (바뀌는 건 한 곳)

1. INK 요청서 OCR 업로드 *(동일)*
2. 자동 매칭, 애매한 것만 검수 화면에 *(동일)*
3. **같은 이름이 둘 이상이면** review에서 "분말/액상" 또는 "어느 제품" **한 번 선택** *(신규 — 지금은 자동 오선택)*
4. 확정 → 사출계획·소요량·가용일이 맞는 잉크로 계산
5. 제품 추가 시: 사용자는 이름·잉크만 입력, **id는 자동 부여(안 보임)**

---

## 4. 데이터 모델 변경

### 4.1 제품에 id
```js
{ id: 'p_00642', name, type, brand, inks, … }   // 신규 id 필드
```
- `migrateData`(app.jsx:8)에서 id 없는 제품에 **안정적 고유 id 1회 부여**(이후 영속). 충돌 없는 순번/토큰.
- `products.jsx` 생성 시 id 부여, 편집/삭제 키를 name→id로 전환(동명 독립 편집 가능해짐).

### 4.2 injection 셀(하위호환)
```js
// 신규
schedule[요일] = { day: { name:'D_Affogato_55% UV', id:'p_00642' }, night: {…} }
// 레거시(그대로 허용)
schedule[요일] = { day: 'D_Affogato_55% UV', night: '…' }
```
- 헬퍼: `productCellName(cell)`(문자열→자기자신, 객체→.name), `productCellId(cell)`(객체→.id, 문자열→null).
- 식별 해소: `productCellId`가 있으면 `resolveProductById`, 없으면(레거시) 기존 `resolveProductIn(name)` 폴백.

---

## 5. 단계별 구현 (위험 분리)

| 단계 | 내용 | 사용자 체감 | 위험 |
|---|---|---|---|
| **P0 데이터** | migrateData가 전 제품에 id 부여 + products.jsx CRUD id 보존/키 전환 | 없음 | 낮음 |
| **P1 해소(하위호환)** | `resolveProductById`, 셀 헬퍼 도입. 셀은 아직 문자열 → **동작 무변경** | 없음 | 낮음 |
| **P2 캡처** | review에서 동명 선택 UI + `applyOcrToInjection`이 `{name,id}` 저장 | "겹칠 때 한 번 선택" | 중간 |
| **P3 표시/편집** | 셀 독자들이 헬퍼 경유(표시는 이름), 수동 편집은 동명 시 선택 | 거의 없음 | 중간 |

레거시 이름 셀은 폴백으로 계속 동작, 재OCR 시 자연히 id화.

---

## 6. 영향 범위 — 바뀌는 화면/함수

| 파일·함수 | 역할 | 변경 |
|---|---|---|
| `app.jsx` migrateData | 로드 마이그레이션 | 제품 id 부여 + 셀 정규화 |
| `data-service.js` buildProductLookup/resolveProductIn | 해소 | byId 인덱스 + `resolveProductById` 추가 |
| `data-service.js` 셀 헬퍼(신규) | 단일 출처 | `productCellName`/`productCellId` |
| `data-service.js` buildDemandByInkDay·buildProductsUsingInk | 소요량/사용제품 | id 경로로 해소 |
| `data-service.js` applyOcrToInjection | OCR 캡처 | `{name,id}` 저장 |
| `data-service.js` moveInjectionCell | 드래그 이동 | 객체 통째 이동(헬퍼) |
| `pages/review.jsx` + matchOcrRow | 검수 | 동명 후보 선택 UI |
| `pages/injection.jsx` | 사출 그리드 렌더·검색·편집 | 표시/검색 헬퍼 경유 |
| `pages/history.jsx` | 스냅샷 diff | 비교를 이름 기준으로(노이즈 방지) |
| `pages/ink-add.jsx` | 넣어줄 잉크 | id 경로 해소 |
| `pages/dashboard.jsx` | 라인업 표 | 표시 헬퍼 경유 |
| `pages/products.jsx` | 제품 CRUD | id 부여·name→id 키 |

**표시 독자(injection/history/dashboard)는 헬퍼만 끼우면 표시 무변화**, 정체성만 정확해진다.

---

## 7. 엣지 케이스

| 케이스 | 처리 |
|---|---|
| 레거시 이름 셀 | `productCellId`=null → 기존 이름 해소 폴백(현행 유지), 재OCR 시 id화 |
| 동명 아닌 99% 제품 | review 자동 매칭 그대로, 선택 UI 안 뜸 |
| 수동 셀 편집 | 이름 입력 → 동명 1건이면 즉시 id, 여러건이면 선택 |
| 제품 삭제/이름변경 후 옛 셀 | id로 추적되어 이름변경에도 유지(삭제는 미해소로 표시) |
| history diff 최초 적용 | 비교를 이름 기준으로 해 노이즈 0 |
| id 안정성 | migrateData가 한 번만 부여·영속(재생성 금지) |

---

## 8. 테스트 계획

| 레벨 | 대상 | 시나리오 |
|---|---|---|
| L1 | migrateData | id 없는 제품에 부여·중복 없음·재실행 안정(영속) |
| L1 | resolveProductById / 셀 헬퍼 | 객체/문자열 셀, 동명 정확 해소, 레거시 폴백 |
| L1 | buildDemandByInkDay | 동명 액상/분말·U-buding이 각자 잉크로 집계 |
| L1 | applyOcrToInjection | 확정 id 저장, 레거시 입력 호환, 멱등 |
| L3 | 셀 독자 회귀 | injection/history/ink-add/dashboard 표시 무변 |

---

## 8.5 P2 상세 — 검수 선택 UX & 캡처

### 자동 좁히기 → 정말 모호할 때만 묻기
`matchOcrRow`가 동명 후보(`sameName`)를 **brand + 제형(variant '액상'→type LIQUID)으로 자동 좁힌다.**
- 1건으로 좁혀지면 → 기존처럼 자동(exact/brand-mismatch), 단 `matchedId` 동봉
- 2건 이상 남으면 → `status:'ambiguous'`, `candidates:[{id,name,type,brand,inks}]`, **검수에서 1회 선택**

대부분의 액상/분말(6쌍)은 variant로 자동 해소 → 사용자는 안 물어봄. **U-buding처럼 이름·제형까지 같은 경우만** 잉크로 구분해 선택.

### 검수 행 picker (ambiguous일 때만)
```text
[44] D_Affogato_55% UV   ⚠ 동명 2개 — 선택
   ○ 분말 · AFFO+GATO
   ● 액상 · CONVEX+ESCAPE      ← variant=액상이면 자동 선택, 사용자는 확인만
─────────────────────────────
[51] U-buding             ⚠ 동명 2개 — 선택 (제형 동일, 잉크로 구분)
   ○ TICO+MATIZ+MORNING
   ○ GRAMPUS+MINKE+SPERM       ← 단서 없음 → 사용자가 직접 선택(미선택 시 pending)
```
- 구분 단서 우선순위: **제형(분말/액상) → 잉크 구성 → 고객/공장**(필요 시).
- variant로 유일하게 좁혀지면 picker 자체를 안 띄움(자동).

### 캡처 — `applyOcrToInjection`
```js
const productName = decision.target || r.product_name;
const id = decision.targetId || resolveUniqueIdByName(data, productName); // 동명 아니면 자동 id
machine.schedule[day][shift] = id ? { name: productName, id } : productName; // 레거시 폴백
```
- 'new' 등록 시 새 제품 id(allocateProductId)를 targetId로.
- id를 못 정하면(레거시·미해소) 문자열 저장 → P1 폴백이 받음.

### 결정(decisions) 모델 확장
`{ action, target, targetId }` — `targetId`만 추가. 기존 흐름 보존.

---

## 9. 비범위

- injection 셀에 형태 외 메타(구분/브랜드)까지 싣는 확장은 추후.
- 액상 변형이 *다른 이름*으로 등록된 제품(Coffee Jelly 등) 마스터 이름 통일은 별도 데이터 정리(id와 무관하게 권장).

---

## Version History

| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-06-19 | 초안(문자열 "(액상)" Option A) |
| 0.2 | 2026-06-19 | id 기반 전환 — U-buding/동명정책 근거, P0~P3 단계화, 영향 화면 목록 |
