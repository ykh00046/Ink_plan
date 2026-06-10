# Plan — 다중 탭 동시편집 가드 (concurrent-edit-guard)

> PDCA Phase: **Plan** · 작성일 2026-06-10 · Level: Dynamic

## 1. 배경

`backend-hardening` PDCA에서 **Out**으로 분리했던 후속 과제. 현재 `POST /api/db`는
`write_current(data)`로 **무조건 덮어쓰기**한다. 운영자가 같은 앱을 두 탭/두 창(또는 다른
PC)에서 열어두면 **lost-update**가 발생한다:

```
탭A 로드(상태S) ─ 탭B 로드(상태S)
탭A 편집→저장(S→A)            ← 서버: A
                  탭B 편집→저장(S→B)  ← 서버: B  (A의 편집 소실, 경고 없음)
```

이 앱은 `data`가 바뀔 때마다 300ms 디바운스로 전체 스냅샷을 POST하므로, 오래 열어둔
스테일 탭이 한 번만 자동저장해도 다른 탭의 누적 작업을 통째로 덮어쓴다. 단일 운영자
도구지만 "어제 켜둔 탭"이 현실적 위험원이다.

## 2. 실제 코드 대조 결과 (Plan 단계 재진단)

| 지점 | 실제 코드 | 문제 |
|------|-----------|------|
| 서버 쓰기 | `server.py:159` `write_current(data)` 무조건 | 버전 검사 없음 → lost-update |
| 서버 읽기 | `server.py:115` `read_current()` | 리비전 토큰 미반환 → 클라가 기준 버전을 알 수 없음 |
| 프론트 저장 | `app.jsx:173` 디바운스 POST(전체 스냅샷) | If-Match 미전송, 409 처리 없음 |
| 프론트 로드 | `app.jsx:146` GET `/api/db` | ETag 미수신 |
| 스토리지 | `storage.py:71` `write_current` (락·atomic 완비) | 조건부 쓰기 변형 부재 |

→ 인프라(RLock·atomic write)는 이미 견고. **버전 토큰 1개**만 GET/POST에 흘리면
낙관적 동시성 제어(OCC)가 성립한다.

## 3. 목표 (Goal)

전체 스냅샷 저장 모델을 유지한 채, **ETag(content-hash) 기반 OCC**로 lost-update를
탐지·차단한다. 충돌 시 **패자의 편집을 보존(localStorage 백업)** 하고 사용자에게
명확히 알린 뒤 최신본으로 정합화한다. **silent loss = 0**이 핵심 성공 지표.

### 측정 가능한 완료 기준 (DoD)
- [ ] `GET /api/db` 응답에 `ETag: "<rev>"` 헤더 동반 (rev = 내용 해시)
- [ ] `POST /api/db`가 `If-Match` 헤더의 base_rev를 현재 rev와 대조 → 일치 시에만 기록, 불일치 시 **409 + 현재 rev** 반환. `If-Match` 부재 시 무조건 기록(폴백/레거시 호환)
- [ ] 성공 응답은 `{ok:true, rev:<new>}` + `ETag` 헤더로 새 rev 전달
- [ ] 동일 내용 재기록은 동일 rev (멱등) — 재시작에도 안정(카운터 파일·데이터 모델 오염 없음)
- [ ] 프론트: 로드 시 rev 저장, 저장 시 If-Match 전송, 성공 시 rev 갱신
- [ ] **자동 병합**: 409 시 서버 최신본을 받아, top-level 섹션(products/inkPlan/injection/…)이 로컬·서버에서 **서로 겹치지 않게** 변경됐으면 자동 병합 후 재저장 (다중탭=서로 다른 페이지 편집의 정상 케이스). 손실 0
- [ ] **충돌 선택 UI**: 같은 섹션이 양쪽 변경된 진짜 충돌일 때만 모달 — **"다시 불러오기(서버 적용)"** / **"내 변경으로 덮어쓰기"** 선택. 충돌 섹션 목록 표시. 어느 쪽이든 패자 스냅샷은 `inkPlanData.conflict`에 백업(silent loss=0)
- [ ] **불필요 저장 제거**: "마지막 동기화본과 동일"이면 저장 skip(로드 직후·충돌 해소 직후 멱등 수렴, 저장 폭주 차단)
- [ ] **순수 함수 분리**: 병합 판정을 `DataService.resolveConcurrentEdit(base, local, server)` + `stableEqual`로 추출해 JS 단위 테스트
- [ ] `storage._LOCK` 단일 락 안에서 read-rev→compare→write 원자 수행 (TOCTOU 없음)
- [ ] Python 테스트 신설(`storage` OCC + `server` 409/ETag), JS 회귀 0
- [ ] 정상 단일 탭 저장/복원/설정 경로 동작 회귀 0

## 4. 범위 (Scope)

### In
- `scripts/storage.py`: `compute_rev()`, `ConflictError`, `current_rev()`, `write_current_checked(data, base_rev)` 추가 (기존 `write_current` 불변 — restore 경로 유지)
- `scripts/server.py`: `send_json`에 헤더 주입 옵션, GET `/api/db` ETag, POST `/api/db` If-Match 검사·409 매핑
- `app.jsx`: `dbRevRef`·`lastSyncedRef` 추적, 로드 ETag 수신, 저장 If-Match 전송, 충돌 핸들러(자동 병합/선택 모달), 멱등 skip 가드
- `data-service.js`: `resolveConcurrentEdit(base, local, server)` + `stableEqual` 순수 함수
- `tests/storage_test.py`·`tests/server_test.py`·`tests/data-service.test.js` 보강

### Out
- 필드(셀) 단위 3-way 병합/CRDT — 섹션(top-level key) 단위까지만 자동 병합, 그 이하 충돌은 사용자 선택
- WebSocket 실시간 동기화·푸시 (폴링/저장 시점 검출로 충분)
- `seed-via-api`(clean.json 완전 비노출) — 별도 후속
- 다중 사용자 인증·권한 (LAN 단일 운영자 범위)

## 5. 리스크 & 완화

| 리스크 | 완화 |
|--------|------|
| 매 GET/POST 전체 DB 해시 비용 | 단일 운영자·소규모 JSON. sha256 16자 절단으로 충분, 체감 0 |
| 409 reload가 자동저장 폭주 유발 | content-hash 멱등: reload→재POST는 동일 내용=동일 rev=성공 1회로 수렴 |
| If-Match 부재 클라가 가드 우회 | 의도된 폴백 호환. 프론트는 항상 전송. 우회는 단일 운영자 환경에서 무의미 |
| 충돌 시 패자 편집 소실 | localStorage `inkPlanData.conflict` 백업 + 명시 토스트 → silent loss 차단 |
| storage 락 재진입 데드락 | 기존 `_LOCK`(RLock) 재사용, 단일 락 순서 |

## 6. 다음 단계
→ `/pdca design concurrent-edit-guard`
