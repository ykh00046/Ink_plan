# Plan — 백엔드 견고화 (backend-hardening)

> PDCA Phase: **Plan** · 작성일 2026-06-09 · Level: Dynamic

## 1. 배경

2026-06-09 전체 코드 품질 검토(프론트/데이터로직/백엔드/테스트 4개 영역 병렬)에서
High 5건은 이미 수정·테스트 완료(JS 127→140, Python 19→20). 남은 **백엔드 Med 묶음**을
이번 PDCA로 닫는다. 대상은 `scripts/server.py` · `scripts/settings_store.py`.

## 2. 실제 코드 대조 결과 (Plan 단계 재진단)

검토 권고를 그대로 신뢰하지 않고 해당 코드를 직접 대조해 정직하게 재진단했다.

| 검토 권고 | 실제 코드 확인 | 진짜 문제 |
|-----------|----------------|-----------|
| ① 에러 응답이 내부 경로 노출 + 잘못된 상태코드 | `server.py:161` `except Exception as e: send_json({"error": str(e)}, 500)` **확인** | `ValueError`(본문 초과·Content-Length 비정수), `JSONDecodeError`, `FileNotFoundError`(절대경로 포함)가 전부 500 + `str(e)`로 누출 |
| ② settings 읽기-수정-쓰기 레이스 | `settings_store.py:45-56` **확인** — `write_api_key()`(자체 read→write) 후 다시 `_read_file_settings()`→수정→`_write_file_settings()` | 락 밖 read + **이중 atomic write**. apiKey 2회 기록, 두 write 사이 reader는 model 미반영 상태를 봄. 동시 저장 시 lost-update |
| ③ `/data/` deny-list 정적 노출 | `BLOCKED_STATIC_PREFIXES=("/data/db","/data/backups","/data/settings")` **확인** | `data/clean.json`·`data/sheets.json`이 차단 목록에 없어 **정적 노출**. ⚠️ 단 `app.jsx:131`이 `/api/db` 실패 시 **`fetch('data/clean.json')`로 시드 폴백** → clean.json은 정적 서빙이 필요. `sheets.json`은 정적 참조 없음. `settings.json`은 prefix로 차단됨 |
| ④ 요청 견고성 공백 | `read_body_json:84` `int(Content-Length)` , `is_api_request_allowed:66` `if host and ...` **확인** | 비정수 Content-Length→500(400이어야), `Transfer-Encoding: chunked`→본문 0바이트 무음 처리, **빈/누락 Host가 가드 통과** |

→ 권고 4건 모두 실재. 단 ②는 "락 추가"만이 아니라 **이중 write 제거**가 핵심,
③은 settings.json은 이미 안전하고 **clean/sheets만** 노출이라는 점을 정확히 반영한다.

## 3. 목표 (Goal)

기존 통과 테스트(JS 140, Python 20)를 깨지 않으면서, 위 4개 백엔드 결함을
**동작 변경 최소 + Python 테스트 동반**으로 닫는다. LAN 단일 도구 특성상 과한
인증 추가는 하지 않고, 정보 노출·상태코드·동시성 정합성만 바로잡는다.

### 측정 가능한 완료 기준 (Definition of Done)
- [ ] **에러 매핑**: `do_POST`가 `ValueError`/`JSONDecodeError`→400, `FileNotFoundError`→404, 그 외→500(일반 메시지, `str(e)` 미노출). 서버 로그에만 상세 기록
- [ ] **요청 견고성**: 비정수 Content-Length→400, `Transfer-Encoding: chunked` 요청→400, 빈/누락 Host→403(가드 통과 차단)
- [ ] **settings 단일 write**: `write_settings`가 `storage._LOCK` 안에서 1회 read→model+apiKey 병합→1회 atomic write. 이중 write·중복 apiKey 기록 제거. `read_settings`/`write_api_key` 외부 동작 동일
- [ ] **정적 노출 차단(deny-by-default + 시드 allow-list)**: `/data/` 트리를 기본 차단하되 프론트 시드 폴백에 필요한 `/data/clean.json`만 명시 허용. `db`·`backups`·`settings`·`sheets.json` 및 향후 `/data/` 신규 파일은 자동 차단. clean.json 정적 폴백(`app.jsx:131`)은 그대로 동작
- [ ] `tests/server_test.py` 보강 + `tests/settings_store_test.py` 신설 — 위 4개 모두 검증
- [ ] 전체 테스트 GREEN: JS 140 유지, Python 20 + 신규
- [ ] 동작 회귀 0 (정상 저장/복원/설정 경로는 그대로)

## 4. 범위 (Scope)

### In
- `scripts/server.py`
  - `do_POST` 예외 분기: 400/404/500 매핑 + 일반 메시지
  - `read_body_json`: 비정수 Content-Length 가드, chunked 거부
  - `is_api_request_allowed`: 빈/누락 Host 거부
  - 정적 차단: `/data/` 기본 차단 + `/data/clean.json` 명시 허용(deny-by-default + seed allow-list)
- `scripts/settings_store.py`
  - `write_settings`를 단일 락·단일 read-modify-write로 재작성 (외부 인터페이스 불변)
- `tests/server_test.py` 보강 / `tests/settings_store_test.py` 신설

### Out
- **다중 탭 lost-update 방지(ETag/revision)** on `/api/db` — 프론트 autosave + 409 충돌 UX까지 건드리는 별도 기능. 후속 `concurrent-edit-guard`로 분리
- **clean.json까지 완전 비노출**(Host/Origin 가드 적용) — `/api/seed` 엔드포인트 신설 + `app.jsx` 폴백을 그쪽으로 전환해야 하는 프론트 변경. 별도 후속(`seed-via-api`)으로 분리. 본 PDCA는 clean.json은 시드 목적상 정적 허용 유지
- 토큰/세션 인증, HTTPS, rate-limit (LAN 단일 도구 범위 외)
- server.py 실소켓 통합 테스트 (핸들러 인스턴스 단위로 검증)
- 기능·UX 변경

## 5. 리스크 & 완화

| 리스크 | 완화 |
|--------|------|
| `/data/` 차단이 정상 정적 자산을 깰 수 있음 | grep 확인 완료: `app.jsx:131`이 `data/clean.json`을 시드 폴백으로 fetch. → clean.json **명시 허용**으로 폴백 보존, 나머지 차단. server_test에 "clean.json 200 / db·backups·sheets 404" 회귀 고정 |
| settings 락 도입 시 storage._LOCK과 데드락 | `write_json_atomic`가 이미 같은 RLock(재진입) 사용 — `RLock`이라 동일 스레드 재획득 안전. 락 순서 단일 |
| 에러 코드 변경이 프론트 기대와 어긋남 | 프론트는 성공 경로(`ok:true`)만 의존. 4xx는 기존에도 일부 존재(403/400/404) — 추가 4xx는 동일 처리 |
| chunked 거부가 정상 클라이언트 차단 | 브라우저 `fetch`는 기본 Content-Length 사용. chunked는 비표준 경로라 거부 안전 |
| Python 테스트에서 소켓 없이 핸들러 구동 | 기존 `server_test.py` 패턴(`Handler.__new__` + fake rfile/wfile BytesIO) 재사용 |

## 6. 다음 단계
→ `/pdca design backend-hardening`
