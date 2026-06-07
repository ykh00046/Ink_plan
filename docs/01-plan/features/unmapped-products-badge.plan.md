# Plan — 마스터 정합성 전역 경고 배지 (unmapped-products-badge)

> PDCA Plan · 2026-06-01 · bkit 추천 추가기능 1순위 (저비용·고효용)

## 1. 배경

bkit이 제안한 추가기능 1순위는 "마스터에 없는 제품 N건 경고 배지"다.
코드 실태를 조사한 결과, **경고에 필요한 데이터는 이미 완전히 계산되고 있다**:

- `data-service.js` `lintMasters()` → `product-not-in-master`("사출계획에 있으나 제품 마스터에 없음", severity=error) 등 7개 카테고리 산출
- `pages/data-quality.jsx`("데이터 점검" 페이지) → 카드·테이블로 표시
- `pages/chemicals.jsx` → `unmappedProducts`(잉크 미등록) 페이지 내 인라인 경고

따라서 이 사이클은 **새 데이터 로직을 만드는 것이 아니라**, 이미 있는 `lintMasters`
결과의 **전역 가시성**을 확보하는 작업이다.

## 2. 문제 정의 (진짜 갭)

현재 사용자는 **"데이터 점검" 페이지로 직접 이동해야만** 마스터 결함을 본다.
재고조사·사출계획·잉크계획 등 일상 작업 화면에서는 다음을 **전혀 인지하지 못한다**:

- 사출계획에 입력됐지만 제품 마스터에 없는 제품 (→ 약품요청서·잉크계획에서 **조용히 누락**)
- 잉크가 비어 있는 제품

이 누락은 발주·생산 누락으로 직결되므로, "지금 처리할 결함이 N건 있다"를
**어느 화면에 있든** 항상 보이게 만드는 것이 핵심 가치다.

## 3. 목표

상시 노출되는 두 위치에 마스터 결함 경고 배지를 추가한다.

1. **사이드바 "데이터 점검" 항목 배지**
   - `lintMasters` error 심각도 합계를 빨간 배지로 표시 (products/test-inks 배지 패턴 재사용)
   - 핵심 지표 `product-not-in-master`("마스터에 없는 제품")가 error에 포함됨
   - 0건이면 배지 미표시

2. **헤더 알림(bell) 버튼 활성화**
   - 현재 `bell` 아이콘 버튼은 클릭해도 동작 없음(죽은 UI)
   - error>0 시 빨간 점/카운트 표시 + 클릭 시 `setView('data-quality')` 이동
   - title(tooltip)에 "마스터에 없는 제품 N건 · 잉크 미등록 M건"으로 분해

## 4. 비목표 (스코프 제외)

- **lintMasters 로직·카테고리 변경**: 데이터 계산은 이미 정확 → 손대지 않음
- **데이터 점검 페이지 UI 개편**: 별도 사이클(추천 4순위 History와 함께 검토 가능)
- **재고 부족 알림·약품요청서 PDF**: 추천 2·3순위, 다음 사이클
- 데이터 모델/스키마 변경 없음

## 5. Definition of Done

- [ ] App에서 `lintMasters(data, {normalize: normalizeProductName})` 1회 `useMemo` 계산
- [ ] 사이드바 "데이터 점검" 항목에 error 합계 배지 (0이면 미표시, 빨강 톤)
- [ ] 헤더 bell 버튼: error>0 시 카운트/점 + 클릭 시 데이터 점검 이동 + 분해 tooltip
- [ ] 동작 보존: 기존 테스트 100% 통과(회귀 0), 데이터 변경 없음
- [ ] 배지 카운트 파생 로직 회귀 방지 단위 테스트 추가 (순수 함수로 추출)

## 6. 리스크 & 완화

| 리스크 | 완화 |
|--------|------|
| `data` 변경마다 lintMasters 전체 순회 | `useMemo([data])` 메모이즈. 셀 수백 개 수준 → 비용 무시 가능 |
| 배지 카운트가 data-quality 페이지와 불일치 | **동일 함수**(`lintMasters`)·동일 normalize 사용으로 단일 출처 보장 |
| app.jsx에 인라인 파생 로직이 늘어 테스트 사각 | error 합계·분해 카운트를 `data-service`의 순수 함수로 추출해 테스트 |
| 글로벌 로드 순서 | index.html: data-service→ui→pages→app 순 — app에서 DataService·normalizeProductName 평가 보장(확인 완료) |
