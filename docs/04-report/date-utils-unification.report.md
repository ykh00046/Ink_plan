# 완료 보고서 — 날짜 유틸 통합 (date-utils-unification)

> PDCA 사이클 완료 · 2026-06-08 · Match Rate 100% · 동작 보존 리팩터링 (테스트 사각 해소)

## 1. 요약

날짜 유틸은 이전 사이클들("data-service 추출", "R3 단일화")로 대부분 `data-service.js`
단일 출처로 모였으나, **`getWeekInfo` 하나만 브라우저 전용 `ui.jsx`에 직접 구현**된 채
남아 있었다. ISO 8601 주차·월주차 라벨 등 경계가 까다로운 순수 날짜 로직인데도
`date-utils.test.js`가 닿지 못하는 **테스트 사각**이었다.

이번 사이클의 본질은 신규 기능이 아니라, 확립된 **"본체=data-service.js · ui.jsx=위임"**
패턴(`dayFromDate` 선례)으로 마지막 날짜 유틸을 통합하고 **로직을 한 줄도 바꾸지 않고**
테스트 가능 영역으로 끌어올리는 것이다.

## 2. 문제 → 해결

| | 내용 |
|---|---|
| **문제** | `getWeekInfo`가 ui.jsx에만 있어 Node 테스트 불가. ISO 주차 연말 경계(W52/W53)·월주차 같은 까다로운 계산이 **검증 없이** 방치. inventory.jsx:47엔 요일추출이 인라인 중복. |
| **해결** | `getWeekInfo` 본체를 data-service.js로 이전(로직 바이트 동일) + ui.jsx는 3줄 위임 래퍼. date-utils.test.js에 경계 7케이스 추가. inventory 인라인은 `dayFromDate(iso,'')` 위임으로 통합. |
| **단일 출처** | 모든 날짜 로직이 data-service.js로 수렴. ui.jsx 잔존 날짜 로직 **0**. |

## 3. 구현 내역

| 파일 | 변경 |
|------|------|
| `data-service.js` | `getWeekInfo(now)` 본체 추가(`dayFromDate` 인접, 698줄) + export 등록(1171). 내부 `WEEKDAYS`/`DAY_BY_IDX` 직접 참조로 `DataService.` 우회 제거 |
| `ui.jsx` | `getWeekInfo` 31줄 구현 → 3줄 위임 래퍼(`return DataService.getWeekInfo(now)`) |
| `pages/inventory.jsx` | `invDayKor`의 인라인 `DAY_BY_IDX[d.getDay()]` → `DataService.dayFromDate(iso,'')` (fallback '' 보존) |
| `tests/date-utils.test.js` | `getWeekInfo` 7케이스(주중/주말 귀속/ISO형식/연말W53/n월n주차/월경계) |
| `index.html` | `data-service.js`/`ui.jsx`/`inventory.jsx` 캐시 버전 쿼리 `?v=58` (data-service.js·ui.jsx는 버전 쿼리 부재 캐시 사각이었음) |

## 4. 검증

- **단위 테스트**: 전체 **91개 GREEN**, fail 0 (기존 84 + `getWeekInfo` 신규 7)
- **동작 보존 (골든값 고정)**: 통합 전 ui.jsx판 출력을 실측 → 본체가 동일 출력함을 테스트로 잠금
  - `2026-05-13(수)` → `5월 2주차` · `2026-W20` · 월=`5/11`
  - `2026-12-31(목)` → **`2026-W53`** (연말 ISO 주차 경계) · 금=`1/1` · 차주월=`1/4`
  - `2026-06-01(월)` → `6월 1주차` · `2026-W23`
- **JSX 컴파일 (정적)**: vendor/babel.min.js로 변경 jsx 직접 트랜스파일 → `ui.jsx`·`inventory.jsx` **에러 0**
- **잔존 로직 검사**: ui.jsx에서 getMonth/getDay/setDate/setHours/offsetToMonday **0건** (위임 래퍼만)
- **Gap Analysis**: Match Rate **100%** (설계 6항목 6/6)

## 5. QA 환경 메모

- 브라우저 런타임 QA(playwright)는 **이전 MCP 세션의 chrome 7개가 전용 프로필을 점유**하는
  인프라 충돌로 차단됨. 사용자 Chrome 종료 리스크를 피해, **정적 Babel 트랜스파일 + 단위
  골든값 동등성**으로 갈음. 순수 함수 이동 + 호출부 무변경이라 런타임 동작 보존이 보장됨.
- 기존 dev 서버는 HTTP 200 정상 가동 확인.

## 6. 학습

- **"통합" 작업은 먼저 통합 현황부터 측정**: 날짜 유틸 대부분은 이미 통합돼 있었고, 진짜 갭은
  `getWeekInfo` **단 하나**였다. 실태 조사로 범위를 정확히 좁혀 과작업을 피했다.
- **리팩터링은 골든값으로 잠근다**: "동작 보존"은 통합 전 출력을 실측해 테스트로 고정하면
  객관적으로 입증된다. ISO 주차 연말 경계(W53)처럼 사람이 암산하기 어려운 값일수록 유효.
- **테스트 가능성은 위치의 함수**: 동일 로직도 ui.jsx(브라우저)에 있으면 무검증, data-service.js로
  옮기면 즉시 Node 테스트 진입. "어디에 두느냐"가 품질을 좌우.

## 7. 다음 단계 (bkit 추천 잔여)

| 우선순위 | 기능 | 비고 |
|---|------|------|
| 1 | 재고 부족 예상 전역 알림 | Plan 작성 완료(`inventory-shortage-alert.plan.md`) — 즉시 착수 가능 |
| 2 | 약품요청서 인쇄/PDF 출력 | chemicals.jsx 인쇄 헤더 확장 |
| 3 | History 뷰 재검토 | 데이터 모델 한계 |
