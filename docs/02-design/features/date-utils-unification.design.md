# Design — 날짜 유틸 통합 (date-utils-unification)

> PDCA Design · 2026-06-08 · [[date-utils-unification.plan]] 기반 · 동작 보존 리팩터링

## 1. 설계 개요

확립된 **"본체 = data-service.js · ui.jsx = 위임 래퍼"** 패턴(`dayFromDate` 선례)을
`getWeekInfo`에 적용한다. 로직은 **한 줄도 변경하지 않고 이동**만 한다.

```
변경 전                              변경 후
─────────                            ─────────
ui.jsx                               data-service.js
  getWeekInfo() { ...로직... }   ──▶   function getWeekInfo(now) { ...동일 로직... }  (본체)
    └ DataService.DAY_BY_IDX            └ DAY_BY_IDX (내부 직접 참조)
    └ WEEKDAYS (전역)                   └ WEEKDAYS (내부 직접 참조)
                                       exports: { ..., getWeekInfo }
                                     ui.jsx
                                       getWeekInfo(now) { return DataService.getWeekInfo(now) }  (위임)
```

## 2. 구현 상세

### 2-1. data-service.js — `getWeekInfo` 본체 추가

`dayFromDate`(654) 직후에 배치 (요일 계산 인접 그룹화):

```js
// 시스템 날짜에서 "이번 주" 정보 계산 (ui.jsx 에서 이전 — 단일 출처).
//   - today: 한국어 요일 ('월'~'일')
//   - dates: { '월':'M/D', ..., '일':'M/D', '차주월':'M/D' }
//   - isoLabel: 'YYYY-Www' (ISO 8601, 그 주 목요일 기준)
//   - monthWeekLabel: 'n월 n주차'
function getWeekInfo(now = new Date()) {
  const days = WEEKDAYS;                       // 내부 상수 직접 참조
  const todayName = DAY_BY_IDX[now.getDay()];  // DataService. 우회 제거
  const offsetToMonday = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - offsetToMonday);
  const dates = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates[days[i]] = `${d.getMonth() + 1}/${d.getDate()}`;
  }
  const nextMon = new Date(monday);
  nextMon.setDate(monday.getDate() + 7);
  dates['차주월'] = `${nextMon.getMonth() + 1}/${nextMon.getDate()}`;
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const isoYear = thursday.getFullYear();
  const yearStart = new Date(isoYear, 0, 1);
  const isoWeek = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  const isoLabel = `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
  const weekOfMonth = Math.floor((monday.getDate() - 1) / 7) + 1;
  const monthWeekLabel = `${monday.getMonth() + 1}월 ${weekOfMonth}주차`;
  return { today: todayName, dates, isoLabel, monthWeekLabel };
}
```

> ⚠️ 로직은 ui.jsx 원본과 **바이트 동일**. 유일 변경: `DataService.DAY_BY_IDX`→`DAY_BY_IDX` (IIFE 내부라 동일 객체), `WEEKDAYS`는 동일 내부 상수.

**exports**: line 1170 `dayFromDate,` 다음 줄에 `getWeekInfo,` 추가.

### 2-2. ui.jsx — 위임 래퍼로 축소

`ui.jsx:131-162`(현 구현 전체)를 다음으로 교체:

```js
// 시스템 날짜에서 "이번 주" 정보 계산. 본체는 data-service.js (위임).
function getWeekInfo(now = new Date()) {
  return DataService.getWeekInfo(now);
}
```

> `now` 기본 인자: 위임 래퍼에서 `new Date()`로 평가 후 전달 → 동작 동일.
> 호출부 `app.jsx:227 getWeekInfo()`는 무변경.

### 2-3. inventory.jsx:47 — 인라인 요일 추출 통합

```js
// 변경 전
return d ? DataService.DAY_BY_IDX[d.getDay()] : '';
// 변경 후 (dayFromDate 위임, fallback '' 유지 → 동작 보존)
return DataService.dayFromDate(iso, '');
```

> 단, 변경 전 코드의 `d`가 이미 파싱된 Date인 경우 `dayFromDate(iso,...)`는 내부에서
> `parseDateLocal` 재호출. **앞단 변수/파싱 경로 확인 후** 동등하면 적용, 아니면 보류
> (이 항목은 보너스 — getWeekInfo 통합이 본질, 동작 보존이 최우선).

### 2-4. index.html — 캐시 버전 쿼리 bump

`ui.jsx?v=N` / `data-service.js?v=N` 쿼리 +1 (브라우저 캐시 사각 해소 — [[unmapped-products-badge]] 교훈).

## 3. 테스트 설계 (date-utils.test.js 추가)

`getWeekInfo`는 `now` 인자를 받으므로 **결정론적 테스트 가능** (고정 Date 주입):

| # | 케이스 | 입력 now | 기대 |
|---|--------|----------|------|
| 1 | 주중(수) 기준 월요일 계산 | 2026-05-13(수) | dates.월='5/11', dates.일='5/17', 차주월='5/18' |
| 2 | today 요일명 | 2026-05-13(수) | today='수' |
| 3 | 일요일 기준(주말도 그 주) | 2026-05-17(일) | dates.월='5/11' (offsetToMonday=6) |
| 4 | ISO 주차 라벨 형식 | 2026-05-13 | isoLabel 매칭 /^\d{4}-W\d{2}$/ |
| 5 | 연말 ISO 주차 경계 | 2026-12-31(목) | isoLabel='2026-W53' (목요일 기준 연도) |
| 6 | n월 n주차 라벨 | 2026-05-13 | monthWeekLabel='5월 2주차' (11일→2주차) |
| 7 | 월 경계: 6/1(월) | 2026-06-01(월) | monthWeekLabel='6월 1주차', dates.월='6/1' |

> 기대값은 구현 실행으로 **실측 후 고정**(특히 #5 ISO 주차). 동작 보존이 목적이므로
> "현 구현이 내는 값"을 골든값으로 잠근다.

## 4. 변경 파일 요약

| 파일 | 변경 |
|------|------|
| `data-service.js` | `getWeekInfo` 본체 추가(654 인근) + export(1170 인근) |
| `ui.jsx` | `getWeekInfo` 31줄 구현 → 3줄 위임 래퍼 |
| `pages/inventory.jsx` | :47 인라인 요일추출 → `dayFromDate(iso,'')` (조건부) |
| `tests/date-utils.test.js` | `getWeekInfo` 7케이스 추가 |
| `index.html` | `ui.jsx` / `data-service.js` 캐시 버전 +1 |

## 5. 구현 순서

1. data-service.js에 `getWeekInfo` 본체 + export 추가
2. 실측으로 테스트 골든값 확정 → date-utils.test.js 작성
3. `node --test` GREEN 확인 (본체가 ui.jsx와 동등함을 고정)
4. ui.jsx 위임 래퍼로 축소
5. inventory.jsx:47 통합 (앞단 파싱 경로 확인 후)
6. index.html 캐시 버전 bump
7. 전체 테스트 재실행 + 브라우저 QA(헤더 주차 라벨 무변화 확인)

## 6. 비기능 요구

- **동작 보존**: 출력 100% 동일 (UI·계산 결과 변화 0)
- **테스트 가능성**: ui.jsx 잔존 로직 0, getWeekInfo Node 테스트 진입
- **일관성**: 기존 위임 패턴([[dayFromDate]])과 동형
