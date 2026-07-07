# Report — 테스트 공백 보강 (test-coverage-hardening)

> PDCA 완료 보고 · 2026-06-01 · Plan→Design→Do→Check→Act 1사이클 완료

## 1. 요약

bkit 1순위 권고 "테스트 공백 보강"을 **실제 코드 대조 재진단** 후, 진짜 비어 있던 영역만 정밀 보강했다.

| 지표 | Before | After |
|------|--------|-------|
| JS 단위 테스트 | 60 pass | **95 pass** |
| Python 단위 테스트 | 5 pass | **19 pass** |
| server.py 가드 테스트 | 0 | **14** (신규 파일) |
| cascade 선택 로직 | ui.jsx 인라인(테스트 불가) | **순수 함수 추출 + 테스트** |
| 재고 lot 엣지케이스 | happy-path만 | **+5 엣지** |

전체 GREEN, 기존 테스트 0개 회귀.

## 2. 핵심 의사결정 (Plan 단계 재진단)

bkit 권고를 맹신하지 않고 코드와 대조한 결과, 권고 ①·③은 **이미 부분 충족**되어 있었다:
- `isInkInMaster`·`buildInkMaster` → 이미 테스트 존재 → **진짜 공백은 cascade 선택 로직**(ui.jsx에 묻힘)
- `removeInventoryLot` 등 → happy-path 존재 → **진짜 공백은 엣지케이스**

→ "없는 걸 새로 다 만들기"가 아니라 **진짜 빈 곳만** 채워 중복 없는 보강 달성.

## 3. 변경 사항

### 영역 A — cascade 순수 추출
- `data-service.js`: `buildCascadeBrands`, `cascadeProductsInBrand`, `cascadeInksInProduct`, `filterByQuery` 추가 (+ export)
- `ui.jsx`: CascadePicker 5개 `useMemo`를 위임으로 교체 — Hook 순서·의존성 배열·반환값 불변(동작 보존)
- `tests/data-service.test.js`: cascade 테스트 5건 추가 (dedup/정렬, brand 필터, 잉크 필터, 검색)
- `null` 항목에 대해 추출 함수가 throw 대신 안전 처리 → 견고성 부수 향상

### 영역 B — server.py 가드 (신규 `tests/server_test.py`)
- `is_api_request_allowed`: Host 가드(DNS rebinding), Origin 가드(CSRF), 빈 Host 통과 동작 명문화 — 8건
- `is_blocked_static`: DB/백업/설정 차단 + 대소문자·퍼센트인코딩 우회 방어 — 6건
- 테스트 더블: `Handler.__new__(Handler)`로 소켓 우회, headers/path만 주입

### 영역 C — 재고 lot 엣지 (`tests/ui-regressions.test.js`)
- 부모 lot 삭제 시 relabel 자식 cascade 제거 / `order` 배열 정리 / 미존재 id idempotent / null inventory 안전 / relabel order>3 상한 — 5건

### 진입점
- `package.json`: `test:py` 스크립트 추가 (`unittest discover -p "*_test.py"`)

## 4. DoD 충족 (Design 기준)
- [x] cascade 순수 추출 + ui.jsx 위임 (동작 보존)
- [x] cascade 순수 함수 테스트
- [x] `tests/server_test.py` 신설 (Host/Origin/정적차단·인코딩우회)
- [x] 재고 lot 엣지케이스 테스트
- [x] 전체 GREEN (JS 95, Python 19) — 기존 회귀 0
- [x] 진입점 갱신

## 5. 검증
```
JS : # tests 95 / # pass 95 / # fail 0
PY : Ran 19 tests ... OK
```

## 6. 후속 제안 (범위 외)
- UI DOM 렌더 테스트는 번들러/테스트 하네스 부재로 보류 — 도입 시 CascadePicker 통합 테스트 가능
- server.py 실제 소켓 통합 테스트(요청→403)는 가드 단위 테스트로 위험 대부분 커버됨
