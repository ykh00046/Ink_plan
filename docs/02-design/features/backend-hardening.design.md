# Design — 백엔드 견고화 (backend-hardening)

> PDCA Phase: **Design** · 작성일 2026-06-09 · Plan: `backend-hardening.plan.md`

## 1. 설계 개요

4개 결함을 2개 파일에서 닫는다. 핵심 원칙: **동작 보존 + 정보노출/상태코드/동시성만 정정**.
의도적 동작 변경은 단 1건(빈 Host 거부, 방어 강화)이며 design에 명시한다.

```
① 에러 매핑      server.py do_POST     예외→400/404/500(일반메시지)
④ 요청 견고성    server.py read_body_json + is_api_request_allowed
③ 정적 노출      server.py is_blocked_static   deny-by-default + clean.json allowlist
② settings 레이스 settings_store.py write_settings  단일 락·단일 write
⑤ 백업 로테이션  storage.py list_backups   파일명→mtime 정렬 + TOCTOU 방어
```

> ⑤는 직전 하드닝 세션에서 선반영된 High 수정(H5)을 본 PDCA 범위로 편입(scope-in)해
> 설계·분석·보고를 일관화한 것이다. 구현·테스트는 이미 완료(아래 §4b 참조).

테스트: `tests/server_test.py` 보강(가드/에러매핑) + `tests/settings_store_test.py` 신설.

---

## 2. ① 에러 매핑 + ④ 요청 견고성 (`scripts/server.py`)

### 2.1 import 추가
```python
import traceback
```

### 2.2 `read_body_json` — chunked 거부 + Content-Length 검증
```python
    def read_body_json(self):
        # chunked 본문은 stdlib 핸들러가 디코드하지 않아 0바이트로 오인됨 → 명시 거부.
        if (self.headers.get("Transfer-Encoding") or "").lower() == "chunked":
            raise ValueError("chunked transfer-encoding not supported")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except (TypeError, ValueError):
            raise ValueError("invalid Content-Length")
        if length < 0:
            raise ValueError("invalid Content-Length")
        if length > MAX_BODY_BYTES:
            raise ValueError(f"request body too large ({length} bytes)")
        raw = self.rfile.read(min(length, MAX_BODY_BYTES + 1))
        if len(raw) > MAX_BODY_BYTES:
            raise ValueError("request body too large")
        text = raw.decode("utf-8")
        return json.loads(text) if text else None
```
> 변경점: chunked 거부, `int()` 실패/음수 → `ValueError`. 정상 경로 동작 동일.

### 2.3 `do_POST` — 예외→상태코드 매핑
```python
    def do_POST(self):
        if not self.is_api_request_allowed():
            self.send_json({"error": "forbidden"}, 403)
            return
        try:
            if self.path == "/api/db":
                data = self.read_body_json()
                if not isinstance(data, dict):
                    self.send_json({"error": "invalid json"}, 400)
                    return
                write_current(data)
                self.send_json({"ok": True})
                return
            if self.path == "/api/backup":
                target = create_backup("manual")
                prune_backups()
                self.send_json({"ok": True, "name": target.name})
                return
            if self.path == "/api/restore":
                data = self.read_body_json() or {}
                restored = restore_backup(data.get("name", ""))
                self.send_json({"ok": True, "name": restored.name})
                return
            if self.path == "/api/settings":
                data = self.read_body_json() or {}
                self.send_json(write_settings(data))
                return
        except ValueError:
            # JSONDecodeError·UnicodeDecodeError 는 ValueError 하위 → 본문 파싱/검증 오류
            self.send_json({"error": "bad request"}, 400)
            return
        except FileNotFoundError:
            self.send_json({"error": "not found"}, 404)
            return
        except Exception:
            traceback.print_exc()  # 상세는 서버 로그에만
            self.send_json({"error": "internal error"}, 500)
            return
        self.send_json({"error": "not found"}, 404)
```
> `str(e)` 노출 제거. `restore_backup`의 `FileNotFoundError`(절대경로 포함)→404. 기타→500 일반메시지.

### 2.4 `is_api_request_allowed` — 빈/누락 Host 거부 (⚠️ 의도적 동작 변경)
```python
        host = (self.headers.get("Host") or "").strip().lower()
        if host not in ALLOWED_HOSTS:   # 기존: if host and host not in ALLOWED_HOSTS
            return False
```
> 빈 문자열은 `ALLOWED_HOSTS`에 없으므로 거부. 브라우저 `fetch`는 항상 Host 전송 → 정상 클라이언트 영향 없음. 비브라우저 LAN 클라이언트의 Host 누락만 차단(방어 강화).

---

## 3. ③ 정적 노출 deny-by-default + 시드 allowlist (`scripts/server.py`)

### 3.1 상수 교체
```python
# 기존: BLOCKED_STATIC_PREFIXES = ("/data/db", "/data/backups", "/data/settings")
BLOCKED_STATIC_PREFIX = "/data/"
STATIC_DATA_ALLOWLIST = ("/data/clean.json",)  # app.jsx 시드 폴백에 필요(소문자)
```

### 3.2 `is_blocked_static`
```python
    def is_blocked_static(self):
        # /data/ 트리는 기본 차단(deny-by-default), 시드 파일만 명시 허용.
        decoded = unquote(urlparse(self.path).path).lower()
        if decoded in STATIC_DATA_ALLOWLIST:
            return False
        return decoded.startswith(BLOCKED_STATIC_PREFIX)
```
> 효과: `clean.json` 허용 / `sheets.json`·`db`·`backups`·`settings.json` 및 향후 `/data/` 신규 파일 자동 차단. `\x00`·인코딩·대소문자 변형은 allowlist 정확일치 실패 → `/data/` prefix로 차단(fail-safe).

---

## 4. ② settings 단일 락·단일 write (`scripts/settings_store.py`)

### 4.1 모듈 락 추가
```python
import threading
_SETTINGS_LOCK = threading.Lock()
```
> 별도 락 사용(storage 내부 `_LOCK` 비침투). `_write_file_settings`→`write_json_atomic`이 storage `_LOCK`을 따로 잡지만 락 순서 단일 → 데드락 없음.

### 4.2 `write_settings` 재작성
```python
def write_settings(data):
    model = (data.get("model") or DEFAULT_MODEL).strip()
    api_key = (data.get("apiKey") or "").strip()
    with _SETTINGS_LOCK:
        file_data = _read_file_settings()      # 락 안에서 1회 read
        file_data["model"] = model
        if api_key:
            file_data["apiKey"] = api_key
        else:
            file_data.pop("apiKey", None)
        _write_file_settings(file_data)         # 1회 atomic write
    return read_settings()
```
> 제거: `write_api_key()` 호출 + 두 번째 read-modify-write(이중 write·apiKey 중복 기록).
> 외부 인터페이스 동일: model 기본값/공백 trim, 빈 apiKey 제거. `read_settings`·`read_api_key`·`write_api_key`는 그대로(다른 호출자 호환).

---

## 4b. ⑤ 백업 로테이션 mtime 정렬 (`scripts/storage.py`) — scope-in

### 문제
`list_backups()`가 파일명 문자열 역순 정렬. 백업명에 `_manual`·`_before_restore`·`-2`
접미사가 붙으면 사전순이 시간순과 어긋나, `prune_backups`가 의미 있는 스냅샷을 먼저 삭제할 수 있음.

### 구현 (완료)
```python
def list_backups():
    ensure_dirs()
    # 파일명(타임스탬프)이 아닌 실제 수정시각 기준 최신순 정렬.
    entries = []
    for p in BACKUP_DIR.glob("*.json"):
        try:
            mtime = p.stat().st_mtime
        except OSError:
            continue  # 조회 중 삭제된 파일(TOCTOU)은 건너뜀
        entries.append((mtime, p.name, p))
    entries.sort(reverse=True)  # (mtime, name) 역순 — 동일 시각은 이름 역순 안정 정렬
    return [p for _, _, p in entries]
```
> `shutil.copy2`가 소스 mtime 보존 → 같은 current 에서 만든 백업은 mtime 동일(이름 tiebreaker, 기존 동작 유지). 날짜가 다르면 mtime 정확 반영. TOCTOU(조회 중 삭제) 시 `OSError` 스킵.

### 테스트 (완료) — `tests/storage_test.py`
`test_list_backups_orders_by_mtime_not_filename`: 이름 역순이면 'zzz'가 앞서지만
`os.utime`로 'aaa'를 더 최신으로 만들어 → mtime 정렬이 'aaa'를 먼저 반환함을 검증.

---

## 5. 테스트 설계

### 5.1 `tests/server_test.py` — 기존 보강 + 신규

**BlockedStaticTest (갱신)**
| path | 기대 | 비고 |
|------|------|------|
| `/data/db/current.json` | True | 유지 |
| `/data/backups/2026.json` | True | 유지 |
| `/data/settings.json` | True | 이제 `/data/` prefix로 차단 |
| `/data/clean.json` | **False** | 시드 allowlist |
| `/DATA/CLEAN.JSON` | **False** | 대소문자 무관 허용 |
| `/data/sheets.json` | **True** | 신규 차단(이전 노출) |
| `/data%2Fsheets.json` | **True** | 인코딩 우회 차단 |
| `/index.html`·`/app.jsx` | False | 유지 |

**ApiGuardTest (1건 갱신)**
| 케이스 | 기대 | 비고 |
|--------|------|------|
| `test_empty_host_allowed` → `test_empty_host_blocked` | **False** | ⚠️ 동작 변경 반영 |
| 그 외 7건 | 기존 동일 | 유지 |

**PostErrorMappingTest (신규)** — `do_POST` 예외 매핑. send_json 스텁으로 (status,payload) 캡처.
```python
def make_post_handler(body=b"", headers=None, path="/api/db"):
    h = server.Handler.__new__(server.Handler)
    base = {"Host": "127.0.0.1", "Content-Length": str(len(body))}
    base.update(headers or {})
    h.headers = base
    h.path = path
    h.rfile = io.BytesIO(body)
    cap = {}
    h.send_json = lambda payload, status=200: cap.update(status=status, payload=payload)
    return h, cap
```
| 케이스 | 입력 | 기대 status |
|--------|------|-------------|
| 비-dict 본문 | `b"123"` (→int) | 400 (invalid json) |
| 깨진 JSON | `b"{bad"` | 400 (bad request) |
| 과대 Content-Length | `Content-Length=99999999999` | 400 |
| 비정수 Content-Length | `Content-Length="abc"` | 400 |
| chunked | `Transfer-Encoding="chunked"` | 400 |
| 미존재 백업 복원 | `/api/restore` body `{"name":"none.json"}` | 404 |
| 외부 Host | `Host=evil.com` | 403 |

> 과대/비정수 CL·chunked 케이스는 `write_current` 도달 전에 차단되므로 실제 DB 변형 없음.

**ReadBodyJsonTest (신규)** — `read_body_json` 직접.
| 케이스 | 기대 |
|--------|------|
| 정상 `{"a":1}` | dict 반환 |
| 빈 본문(CL=0) | None |
| 과대 CL | `ValueError` |
| 비정수 CL | `ValueError` |
| chunked | `ValueError` |

### 5.2 `tests/settings_store_test.py` — 신규

`SETTINGS_FILE`을 임시 경로로 patch(`storage_test.py` 패턴). 각 케이스:
| 테스트 | 검증 |
|--------|------|
| round-trip | `write_settings({apiKey:'X', model:''})` → read `{apiKey:'X', model:DEFAULT}` |
| 빈 apiKey 제거 | 키 있는 상태에서 `write_settings({apiKey:'  '})` → 파일에 `apiKey` 키 없음 |
| 단일 write 정합성 | `write_settings({apiKey:'X', model:'M'})` 후 파일을 직접 읽어 `model`·`apiKey` **둘 다** 존재(반쪽 상태 없음) |
| 미존재 파일 read | 파일 없을 때 `read_settings()` → `{apiKey:'', model:DEFAULT}` |
| model 공백 → 기본 | `write_settings({model:'   '})` → `read.model == DEFAULT` |

---

## 6. 구현 순서

1. `settings_store.py` ② (가장 독립적, 외부 인터페이스 불변) → `settings_store_test.py` 작성·GREEN
2. `server.py` ③ 정적 상수·`is_blocked_static` → `server_test.py` BlockedStatic 갱신·GREEN
3. `server.py` ④ `read_body_json`·`is_api_request_allowed` → ReadBodyJson + ApiGuard 갱신·GREEN
4. `server.py` ① `do_POST` 매핑 + `import traceback` → PostErrorMapping·GREEN
5. ⑤ `storage.py list_backups` mtime 정렬 → `test_list_backups_orders_by_mtime_not_filename`·GREEN (선반영 완료)
6. 전체 회귀: JS 140 유지 + Python(기존 20 + 신규) GREEN
7. `/pdca analyze backend-hardening` (gap-detector)

## 7. 영향/회귀 체크리스트
- [ ] 정상 저장(`POST /api/db` dict) · 백업 · 복원 · 설정 저장 경로 동작 동일
- [ ] `app.jsx:131` `data/clean.json` 시드 폴백 200 유지
- [ ] 프론트는 4xx를 신규로 마주쳐도 성공경로(`ok:true`)만 의존 → UX 영향 없음
- [ ] 빈 Host 거부가 정상 브라우저 fetch에 영향 없음(브라우저는 Host 항상 전송)
