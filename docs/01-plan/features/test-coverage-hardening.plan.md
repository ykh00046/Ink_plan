# Plan — 테스트 공백 보강 (test-coverage-hardening)

> PDCA Phase: **Plan** · 작성일 2026-06-01 · Level: Dynamic

## 1. 배경

이전 bkit 분석이 1순위 개선으로 "테스트 공백 보강"을 권고하며 3개 항목을 지목:
1. `isInkInMaster` + cascade 함수 단위 테스트 없음
2. `server.py` Origin/Host 가드 Python 테스트 없음
3. 재고 lot 변형 함수군(`removeInventoryLot` 등) 테스트 없음

## 2. 실제 코드 대조 결과 (Plan 단계 재진단)

권고를 그대로 신뢰하지 않고 실제 테스트/코드를 대조한 결과, **권고 일부는 이미 충족**되어 있었다. 정직한 재진단:

| bkit 권고 | 실제 상태 | 진짜 공백 |
|-----------|-----------|-----------|
| ① isInkInMaster + cascade | `isInkInMaster`·`buildInkMaster` **이미 테스트됨** (`data-service.test.js:378–433`) | cascade **선택 로직**(브랜드→제품→잉크 파생/검색)이 `ui.jsx` CascadePicker 인라인 `useMemo`에 묻혀 **순수 테스트 불가** |
| ② server.py 가드 | `is_api_request_allowed`·`is_blocked_static` **테스트 전무** (`storage_test.py`는 storage.py만 검증) | **전면 공백** — 보안 직결 |
| ③ 재고 lot 변형 | `removeInventoryLot`·`removeInventoryInk`·`relabelInventoryLot` **happy-path 테스트 존재** (`ui-regressions.test.js:49–155`) | **엣지케이스 공백**: 자식 lot cascade 삭제, order>3 상한, null/누락-id 견고성, order 배열 보존 |

→ 따라서 "없는 테스트를 새로 다 만든다"가 아니라 **진짜 비어 있는 곳만** 정밀 보강한다.

## 3. 목표 (Goal)

기존 통과 테스트(JS 60, Python 5)를 깨지 않으면서 위 3개 영역의 **진짜 공백**을 단위 테스트로 닫는다.

### 측정 가능한 완료 기준 (Definition of Done)
- [ ] cascade 선택 로직이 `data-service.js` 순수 함수로 추출되고 `ui.jsx`가 위임 (동작 보존)
- [ ] cascade 순수 함수 단위 테스트 추가 (브랜드 파생/정렬·dedup, 브랜드별 제품, 제품별 잉크, 검색 필터)
- [ ] `tests/server_test.py` 신설 — Host 가드/Origin 가드/정적 차단(인코딩 우회 포함) 검증
- [ ] 재고 lot 변형 엣지케이스 테스트 추가 (자식 cascade, order>3 상한, null/누락 입력, order 배열 보존)
- [ ] 전체 테스트 GREEN: JS 기존 60 + 신규, Python 기존 5 + 신규
- [ ] `package.json` / 실행 명령에 신규 테스트 반영

## 4. 범위 (Scope)

### In
- `data-service.js`: cascade 파생 순수 함수 추가 (`buildCascadeBrands`, `productsInBrand`, `inksInProduct`, `filterCascadeItems`) — 동작 보존 추출
- `ui.jsx`: CascadePicker가 위 순수 함수에 위임 (로직 이동, 동작 동일)
- `tests/data-service.test.js`(또는 신규 섹션): cascade 순수 함수 테스트
- `tests/server_test.py`: 신규 — 가드/정적차단 테스트
- `tests/ui-regressions.test.js`: 재고 lot 엣지케이스 추가
- 실행 진입점(`package.json`) 갱신

### Out
- UI DOM 렌더 테스트(브라우저 Babel·번들러 없음 → DOM 테스트 하네스 부재, 본 PDCA 범위 외)
- server.py의 실제 소켓/통합 테스트 (가드 로직은 핸들러 인스턴스 단위로 검증)
- 기능 변경·리팩터 이상의 동작 변경

## 5. 리스크 & 완화

| 리스크 | 완화 |
|--------|------|
| ui.jsx CascadePicker 추출 시 회귀 (DOM 테스트 부재) | 로직을 **그대로 이동**(set/filter 동일), 순수 함수에 동일 입력 동등성 테스트로 고정 |
| server.py 핸들러를 소켓 없이 인스턴스화 난이도 | `Handler.__new__(Handler)`로 소켓 우회, `headers`/`path`만 주입 (메서드가 그 둘만 읽음) |
| Python 테스트 import 경로 | `storage_test.py`와 동일 패턴(`sys.path.insert`) 재사용 |

## 6. 다음 단계
→ `/pdca design test-coverage-hardening`
