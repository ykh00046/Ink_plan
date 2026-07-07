# Gap Analysis — 날짜 유틸 통합 (date-utils-unification)

> PDCA Check · 2026-06-08 · Match Rate **100%** · 동작 보존 검증 완료

## 1. 설계 ↔ 구현 대조

| # | 설계 항목 | 구현 | 위치 | 상태 |
|---|-----------|------|------|------|
| 1 | `getWeekInfo` 본체 data-service.js 이전 | 본체 추가 (로직 바이트 동일, `DataService.`우회 제거) | data-service.js:698 | ✅ |
| 2 | exports에 `getWeekInfo` 추가 | `dayFromDate,` 다음 줄 | data-service.js:1171 | ✅ |
| 3 | ui.jsx 위임 래퍼로 축소 (31줄→3줄) | `return DataService.getWeekInfo(now)` | ui.jsx:130-132 | ✅ |
| 4 | date-utils.test.js 경계 케이스 | 7케이스 (주중/주말/ISO주차/연말W53/월경계) | date-utils.test.js | ✅ |
| 5 | inventory.jsx:47 인라인 요일추출 통합 | `DataService.dayFromDate(iso, '')` (fallback '' 보존) | inventory.jsx:45-48 | ✅ |
| 6 | index.html 캐시 버전 bump | data-service.js/ui.jsx/inventory.jsx `?v=57` | index.html | ✅ |

**Match Rate: 6/6 = 100%**

## 2. 동작 보존 검증

- **골든값 고정**: 통합 전 ui.jsx판 출력을 실측 → 본체가 동일 출력함을 테스트로 잠금
  - `2026-05-13(수)` → `5월 2주차`, `2026-W20`, dates.월=`5/11`
  - `2026-12-31(목)` → `2026-W53` (연말 ISO 주차 경계), dates.금=`1/1`
  - `2026-06-01(월)` → `6월 1주차`, `2026-W23`
- **inventory `invDayKor`**: 기존 `DataService.DAY_BY_IDX[parseDateLocal(iso).getDay()] : ''` 와
  `dayFromDate(iso,'')` 가 **바이트 동등**(같은 parseDateLocal·DAY_BY_IDX 경로, fallback만 '') → 회귀 없음

## 3. 테스트 결과

```
# tests 91   # pass 91   # fail 0
```
- 기존 84 + `getWeekInfo` 신규 7 = 91, 회귀 0
- ui.jsx 잔존 날짜 로직: **0** (grep: getMonth/getDay/setDate/setHours/offsetToMonday 0건 → 위임 래퍼만)

## 4. 잔여/이월

| 항목 | 판단 |
|------|------|
| `pages/ocr-import.jsx` 날짜 조작 | OCR 특수 파싱 — 범용 유틸 아님, 의도적 범위 외 (Plan §4) |
| 브라우저 런타임 QA | 다음 단계(헤더 주차 라벨 무변화 시각 확인) |

## 5. 결론

설계 100% 구현. 신규 임계값·로직 발명 0, 코드 이동·테스트 추가만으로 **테스트 사각(getWeekInfo) 해소**.
Match Rate 100% ≥ 90% → **iterate 불필요**, QA 후 Report로 진행.
