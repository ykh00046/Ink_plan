# Plan — 날짜 유틸 통합 (date-utils-unification)

> PDCA Plan · 2026-06-08 · 리팩터링(동작 보존) · 테스트 사각 해소

## 1. 배경

이전 사이클들("data-service 추출", "R3 매직 문자열·정규화 단일화")로 날짜 유틸은 대부분
`data-service.js` 단일 출처로 모였다. 실태 조사 결과:

| 자산 | 본체 위치 | 통합 상태 |
|------|-----------|-----------|
| `WEEKDAYS` / `WEEKDAYS_PLUS` / `DAY_BY_IDX` | data-service.js:13-15 | ✅ 단일 출처, 전 페이지가 참조 |
| `parseDateLocal` / `localDateISO` | data-service.js | ✅ 본체 + 테스트(date-utils.test.js) |
| `dayFromDate` | data-service.js:654 | ✅ 본체 + ui.jsx:114 위임 래퍼 |
| `dateFromLotNo` / `lotSequenceForDate` | data-service.js | ✅ 본체 + 테스트 |
| **`getWeekInfo`** | **ui.jsx:131 (직접 구현)** | ❌ **미통합 — data-service.js에 없음** |

## 2. 문제 정의 (진짜 갭)

`getWeekInfo(now)`는 **순수 날짜 로직**인데 브라우저 전용 `ui.jsx`에만 산다:

- 이번 주 월요일 계산(`offsetToMonday`), 요일별 `M/D` dates 매핑(+`차주월`)
- **ISO 8601 주차** 계산(그 주 목요일 기준), `n월 n주차` 라벨

이 복잡한 경계 로직(연말 주차 롤오버, 월 경계 주차 등)이 **date-utils.test.js의 사각지대**다.
다른 날짜 유틸은 모두 data-service.js로 통합돼 Node 테스트를 받는데, `getWeekInfo`만
검증 없이 방치돼 있다. 이미 확립된 **"본체 = data-service.js + ui.jsx 위임"** 패턴
([[dayFromDate]] 선례)에서 유독 이탈한 상태.

부수 갭: `pages/inventory.jsx:47`이 `DataService.DAY_BY_IDX[d.getDay()]`로 **요일 추출을
인라인 재구현**(= `dayFromDate`의 중복). fallback만 `''`로 다름.

## 3. 목표

확립된 위임 패턴으로 마지막 날짜 유틸을 통합하고 테스트 사각을 없앤다. **동작 100% 보존.**

1. **`getWeekInfo` 본체를 data-service.js로 이전**
   - data-service.js 내부에서 `WEEKDAYS`/`DAY_BY_IDX` 직접 참조 (현 ui.jsx판은 `DataService.` 우회)
   - `ui.jsx:131`은 `return DataService.getWeekInfo(now)` **위임 래퍼**로 축소 ([[dayFromDate]]와 동일)
   - exports에 `getWeekInfo` 추가
2. **date-utils.test.js에 `getWeekInfo` 테스트 추가**
   - 주중/주말 기준일, ISO 주차(연말 경계), `n월 n주차`, `차주월` dates 등 경계 케이스
3. **`inventory.jsx:47` 인라인 요일 추출을 `dayFromDate(iso, '')` 위임으로 정리** (fallback `''` 유지 → 동작 보존)

## 4. 범위 (Scope)

### In Scope
- `getWeekInfo` data-service.js 이전 + ui.jsx 위임 + export
- date-utils.test.js 신규 케이스
- inventory.jsx:47 dayFromDate 위임 (동작 보존)
- 캐시 버전 쿼리 bump (index.html), APP_REV 유지/필요시 bump

### Out of Scope
- `pages/ocr-import.jsx`의 날짜 조작 → OCR 특수 파싱 로직, 범용 유틸 아님 (별도 사이클)
- 날짜 표현/포맷 UI 변경 (순수 내부 리팩터링)
- 신규 기능 추가 (이번 사이클은 통합·테스트만)

## 5. 리스크

| 리스크 | 대응 |
|---|---|
| 이전 과정에서 ISO 주차 계산 미세 변동 | 코드 **그대로 이동**(로직 한 줄도 안 바꿈), 테스트로 동등성 고정 |
| `getWeekInfo`가 ui.jsx 전역 `WEEKDAYS` 의존 → 이전 시 스코프 깨짐 | data-service.js 내부엔 동일 `WEEKDAYS` 존재 → 내부 참조로 전환(오히려 견고) |
| inventory.jsx fallback 차이('' vs '월') 회귀 | `dayFromDate(iso, '')`로 **명시적 '' 전달** → 기존과 동일 출력 |
| app.jsx `getWeekInfo()` 호출부 회귀 | ui.jsx 위임이 동일 시그니처 유지 → 호출부 무변경 |

## 6. 성공 기준

- `DataService.getWeekInfo`가 기존 ui.jsx판과 **동일 출력** (테스트로 고정)
- 단위 테스트 GREEN — 기존 전부 + `getWeekInfo` 신규 케이스, 회귀 0
- ui.jsx에 날짜 **로직** 0 (위임 래퍼만 잔존)
- 브라우저 QA: 헤더 주차 라벨(`weekInfo.monthWeekLabel`)·요일 표시 변화 없음
- Gap Analysis Match Rate ≥ 90%

## 7. 다음 단계

| 우선순위 | 기능 | 비고 |
|---|------|------|
| - | 재고 부족 예상 전역 알림 | [[inventory-shortage-alert]] (Plan 작성 완료, 대기) |
| 3 | 약품요청서 인쇄/PDF | chemicals.jsx 인쇄 헤더 확장 |
