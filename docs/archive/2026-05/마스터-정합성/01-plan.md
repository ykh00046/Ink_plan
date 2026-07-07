# Plan — 마스터 정합성 검증 페이지 (Data Lint)

작성일: 2026-05-27
작성자: 김선명(생산관리팀) — 단일 사용자 운영
관련 메모리: [[project-overview]] [[project-data-model]] [[product-matching-policy]]
관련 R1 산출물: `docs/03-analysis/약품요청서-report.md` (§7 후속 작업 4번)

## 1. 배경 / Problem

이번 라운드에 추가한 약품요청서 페이지가 부산물로 `unmappedProducts`(잉크 미등록 제품)를 산출하고 경고를 띄운다. 그러나 비슷한 마스터 데이터 결함은 다른 위치에도 존재한다:

- **사출계획 셀에 있지만 제품 마스터에 없는 제품** → 잉크/약품요청서 계산에서 누락
- **제품에 잉크가 하나도 없음** → 약품요청서에서 unmappedProducts 로 분류
- **잉크에 품목코드 없음** → 약품요청서 비고에 "마스터 보완" 표기
- **잉크에 사용 호기 미지정** → 약품요청서 "미지정" 표기
- **재고(`data.inventory.lots`) 에 있지만 어떤 제품도 사용하지 않는 잉크 (고아 잉크)** → 잉크계획에서 의미 없는 줄
- **machineAssignments에 같은 잉크 이름이 중복 등록**

지금은 이런 결함이 각 페이지에서 따로 발견되고, 사용자(김선명)가 어디를 손봐야 하는지 흩어진 단서만 받는다. **한 화면에서 카테고리별로 모아 보고, 클릭 한 번에 해당 마스터 페이지로 이동**해야 데이터 품질 유지가 현실적으로 가능하다.

## 2. 사용자 시나리오

> 김선명이 주 1회 또는 데이터 임포트 직후에 다음을 한다.
>
> 1. 좌측 NAV `마스터 > 데이터 점검` 클릭
> 2. 카테고리별 카드 (제품 결함 N건 / 잉크 결함 N건 / 잡음 N건) 가 한눈에 보임
> 3. 카테고리 카드를 열면 영향받는 항목 목록 (예: "잉크 미입력 제품 7개")
> 4. 항목 행을 클릭 → 해당 마스터 페이지(제품 / 잉크) 로 이동해서 즉시 수정
> 5. 수정 후 다시 페이지에 돌아오면 자동으로 재집계

## 3. 도메인 규칙 (확정)

검증 카테고리(7종):

| 코드 | 한국어 | severity | 설명 | 빠른 이동 |
|---|---|---|---|---|
| `product-not-in-master` | 사출계획에 있으나 제품 마스터에 없음 | error | injection 셀 제품명이 products[] 에 없음 | products |
| `product-no-inks` | 제품에 잉크가 비어 있음 | error | products[].inks 가 [null,null,null] | products |
| `ink-not-in-assignments` | 잉크가 machineAssignments에 등록 안 됨 | warn | products[].inks에 있지만 machineAssignments에 없음 | machines |
| `ink-no-code` | 잉크 품목코드 미입력 | warn | machineAssignments[].code 비어 있음 | machines |
| `ink-no-machine` | 잉크 사용 호기 미지정 | warn | machineAssignments[].machine 비어 있음 | machines |
| `duplicate-ink-assignment` | 같은 잉크가 여러 호기에 중복 등록 | warn | machineAssignments에 동일 ink 이름이 2개 이상 | machines |
| `orphan-ink-assignment` | 사용되지 않는 잉크 마스터 | info | machineAssignments에 있지만 어떤 product의 inks에도 없음 | machines |

- 비교는 `ui.jsx`의 `normalizeProductName` 으로 정규화 (대소문자/공백/특수문자 차이 흡수)
- 잉크 이름은 trim 후 case-sensitive 비교 (잉크 마스터는 사용자가 직접 관리하므로 표기 통일됨)
- 빈 데이터(`null`, 빈 배열)는 0건으로 계산하고 충돌 없이 통과

## 4. 입력 / 출력

### 입력
- `data.products` (제품 → 잉크 마스터)
- `data.machineAssignments` (잉크 → 코드/호기)
- `data.injection` (사출계획)
- `data.inventory.lots`(옵션, 있을 때만)

### 출력
순수 함수 결과:
```js
{
  summary: { total, byCategory: { [code]: count }, bySeverity: { error, warn, info } },
  issues: [
    { category, severity, label, target, detail, navTo, key }
  ]
}
```
- `issues` 는 severity desc → category → target 순서로 정렬
- `key` 는 React 키 안정성을 위한 결정적 문자열

### 화면
- 상단: 헤더 + 메타칩 (`이슈 총 N건` / `error K · warn K · info K`)
- 중단: 카테고리 카드 그리드 (7개) — 카드 클릭 시 펼침/접힘
- 하단: 펼친 카테고리의 이슈 행 테이블 — 행 클릭 시 해당 마스터 페이지로 setView

## 5. 범위 (Scope)

### IN
- 새 페이지 `pages/data-quality.jsx` (이름: `DataQualityPage`, NAV id: `data-quality`, 라벨: `데이터 점검`)
- `data-service.js`에 순수 함수 `lintMasters(data)` 추가
- 단위 테스트 (tests/data-service.test.js) — 카테고리별 5+개
- NAV `마스터` 그룹 마지막에 등록 + 라우팅
- index.html 스크립트 1줄 추가

### OUT
- 자동 수정 / 일괄 수정 — 사용자가 의도적으로 둔 누락(예: 양산대응 중인 신제품)이 있을 수 있어 자동 수정은 위험
- 변경 이력 / undo — 단일 사용자 + 자동 백업으로 커버
- 재고 잉크와 마스터 불일치 검사 — `data.inventory.lots` 가 없을 수도 있는 환경 고려, 이번 스코프 보류

## 6. 성공 기준

1. 빈 데이터 → 이슈 0건, 충돌 없이 페이지 로드
2. 결함이 있는 실제 `data/clean.json` 에서 7개 카테고리가 정확히 분류됨
3. 카드 클릭으로 펼침/접힘, 행 클릭으로 마스터 페이지 이동
4. 1000건 이상 셀이 있는 사출계획에서 1초 이내 집계
5. 단위 테스트 5+개 통과
6. 기존 페이지(약품요청서·재고·제품·잉크) 동작에 영향 없음

## 7. 위험 / 미정 사항

- 정규화 비교는 `normalizeProductName` 을 그대로 쓰지만, 이 함수가 *현장 표기*에 맞춰져 있어서 자세히 본 적은 OCR/검수 페이지 뿐. 잘못 매칭하는 케이스가 보이면 추후 보정.
- "orphan-ink-assignment" 는 *현재 사출계획 기준* 으로만 판단. 양산대응(테스트) 잉크는 일시적으로 사용되지 않을 수 있어 severity = info (경고 아님).
- 재고 정합성 검사는 이번 라운드 외(데이터 구조가 다른 작업과 얽혀 있어 분리).
