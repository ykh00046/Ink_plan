# Design — 다중 탭 동시편집 가드 (concurrent-edit-guard)

> PDCA Phase: **Design** · 작성일 2026-06-10 · Plan: `concurrent-edit-guard.plan.md`

## 1. 설계 개요 — ETag 기반 낙관적 동시성 제어(OCC)

HTTP 표준 OCC(`ETag` + `If-Match`)를 그대로 차용한다. **리비전 = 현재 DB 내용의
sha256 16자 해시**. 카운터 파일·데이터 모델 필드를 추가하지 않아 재시작·복원에 안정적이고,
동일 내용 쓰기는 동일 rev가 되어 멱등하다.

```
GET  /api/db                  → 200 {data}            ETag: "<rev>"
POST /api/db  If-Match:"<rev>" → 200 {ok,rev:<new>}    ETag: "<new>"   (일치)
                              → 409 {error,rev:<cur>}  ETag: "<cur>"   (불일치)
POST /api/db  (If-Match 없음)  → 200 무조건 기록        (폴백/레거시)
```

## 2. storage.py — 조건부 쓰기

```python
import hashlib

class ConflictError(Exception):
    """OCC: base_rev 가 현재 rev 와 불일치(다른 탭이 먼저 저장)."""
    def __init__(self, current_rev):
        super().__init__("revision conflict")
        self.current_rev = current_rev

def compute_rev(data):
    # 내용 기반 리비전 — 키 순서 무관 정규화 후 해시. 동일 내용=동일 rev(멱등).
    canonical = json.dumps(data, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()[:16]

def current_rev():
    with _LOCK:
        ensure_current()
        return compute_rev(read_json(CURRENT_FILE))

def write_current_checked(data, base_rev):
    # base_rev=None → 무조건 기록(폴백). 값이 있으면 일치할 때만 기록.
    with _LOCK:                          # 단일 락 안에서 read-rev→compare→write (TOCTOU 차단)
        ensure_current()
        cur = compute_rev(read_json(CURRENT_FILE))
        if base_rev is not None and base_rev != cur:
            raise ConflictError(cur)
        write_json_atomic(CURRENT_FILE, data)
        return compute_rev(data)
```

- 기존 `write_current(data)`는 **변경 없음** → `restore_backup` 등 무조건 경로 유지.
- `_LOCK`은 RLock이고 `write_json_atomic`도 동일 락 → 재진입 안전.

## 3. server.py — 헤더 주입 + 엔드포인트

### send_json 헤더 옵션 (하위호환)
```python
def send_json(self, data, status=200, headers=None):
    ...
    self.send_header("Content-Length", str(len(body)))
    if headers:
        for k, v in headers.items():
            self.send_header(k, v)
    self.end_headers()
    self.wfile.write(body)
```

### GET /api/db
```python
if path == "/api/db":
    data = read_current()
    self.send_json(data, headers={"ETag": f'"{compute_rev(data)}"'})
    return
```

### POST /api/db
```python
if self.path == "/api/db":
    data = self.read_body_json()
    if not isinstance(data, dict):
        self.send_json({"error": "invalid json"}, 400); return
    new_rev = write_current_checked(data, self._if_match_rev())
    self.send_json({"ok": True, "rev": new_rev}, headers={"ETag": f'"{new_rev}"'})
    return
```

### If-Match 파서 + 409 매핑
```python
def _if_match_rev(self):
    raw = self.headers.get("If-Match")
    return raw.strip().strip('"') if raw else None
```
`do_POST` 외부 try에 **ConflictError 분기 추가**(generic Exception 앞):
```python
except ConflictError as e:
    self.send_json({"error": "conflict", "rev": e.current_rev}, 409,
                   headers={"ETag": f'"{e.current_rev}"'})
    return
```
- `ConflictError`는 `Exception` 직계라 기존 `ValueError`/`FileNotFoundError` 분기에 안 걸림.
- import: `from storage import (..., compute_rev, write_current_checked, ConflictError)`.

## 4. app.jsx — rev 추적 + 409 UX

### ref 추가 (`toastTimer` 옆)
```js
const dbRevRef = useRef(null);      // 서버 DB 리비전(ETag) — OCC base
const lastSyncedRef = useRef(null); // 마지막으로 서버와 일치한 data — 병합/skip의 base
const [conflictState, setConflictState] = useState(null); // {local,server,serverRev,conflictKeys} | null
```

### 로드 GET — ETag 수신
```js
fetch('/api/db', { cache: 'no-store' })
  .then(r => {
    if (!r.ok) throw new Error(`api ${r.status}`);
    dbRevRef.current = (r.headers.get('ETag') || '').replace(/"/g, '') || null;
    return r.json();
  })
```

### 멱등 skip 가드 (저장 effect 진입부)
```js
const snapshot = data;
if (DataService.stableEqual(snapshot, lastSyncedRef.current)) return; // 로드/해소 직후 무변경 → skip
```
→ 순수 로드, reload·병합·덮어쓰기 직후(아래에서 `lastSyncedRef`를 방금 setData한 값으로 맞춤)
자동저장이 재발동해도 즉시 빠져나가 **저장 폭주·자기충돌 0**.

### postDb 헬퍼 (If-Match 송신 + ETag 수신)
```js
async function postDb(payload, baseRev) {  // 200→{rev}, 409→throw {conflict:true}, 기타→throw
  const r = await fetch('/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               ...(baseRev ? { 'If-Match': `"${baseRev}"` } : {}) },
    body: JSON.stringify(payload),
  });
  if (r.status === 409) { const e = new Error('conflict'); e.conflict = true; throw e; }
  if (!r.ok) throw new Error(`file DB ${r.status}`);
  const body = await r.json().catch(() => ({}));
  return body.rev || (r.headers.get('ETag') || '').replace(/"/g, '') || null;
}
```

### 저장 흐름
```
postDb(snapshot, dbRevRef.current)
  ├ 성공 rev      → dbRevRef=rev; lastSyncedRef=snapshot
  ├ conflict(409) → await handleConflict(snapshot)
  └ 기타 오류     → 기존 localStorage 폴백 + 토스트(동작 유지)
```

### 충돌 핸들러 handleConflict(local)
```js
const fresh = await fetch('/api/db', { cache:'no-store' });
const serverRev = (fresh.headers.get('ETag')||'').replace(/"/g,'') || null;
const server = migrateData(await fresh.json());
const res = DataService.resolveConcurrentEdit(lastSyncedRef.current, local, server);
if (res.status === 'identical') {            // 로컬==서버: rev만 동기화
  dbRevRef.current = serverRev; lastSyncedRef.current = server;
} else if (res.status === 'merged') {        // 섹션 비충돌: 자동 병합 후 재저장
  const rev = await postDb(res.data, serverRev);   // 재충돌 시 catch→모달 강등
  dbRevRef.current = rev; lastSyncedRef.current = res.data; setData(res.data);
  notify('다른 창의 변경과 자동 병합되었습니다');
} else {                                     // 진짜 충돌: 사용자 선택
  try { localStorage.setItem('inkPlanData.conflict', JSON.stringify(local)); } catch(e){}
  setConflictState({ local, server, serverRev, conflictKeys: res.conflictKeys });
}
```

### 충돌 모달 ConflictModal
- 충돌 섹션 라벨(`SECTION_LABELS[key]`) 목록 표시.
- **다시 불러오기(서버 적용)**: `setData(server); dbRevRef=serverRev; lastSyncedRef=server;` 닫기.
- **내 변경으로 덮어쓰기**: `rev=await postDb(local, serverRev); dbRevRef=rev; lastSyncedRef=local; setData(local);` 닫기.
- 두 선택 모두 패자 후보는 `inkPlanData.conflict`에 백업되어 **silent loss=0**.

### 멱등 수렴 분석
모든 해소 경로가 `lastSyncedRef`를 방금 `setData`한 값과 일치시키므로, 재발동된 저장
effect는 `stableEqual` 가드에서 즉시 skip → **저장 폭주 없음**. 병합/덮어쓰기는 명시적
`postDb` 1회로 끝난다.

## 4-bis. data-service.js — 병합 판정 순수 함수

```js
function stableEqual(a, b) {            // 배열=순서 민감, 객체=키순서 무관 재귀 비교
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return a === b;
  const aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr) return a.length === b.length && a.every((v,i)=>stableEqual(v,b[i]));
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every(k => Object.prototype.hasOwnProperty.call(b,k) && stableEqual(a[k],b[k]));
}

function resolveConcurrentEdit(base, local, server) {
  if (stableEqual(local, server)) return { status:'identical' };
  if (!base || typeof base !== 'object') return { status:'conflict', conflictKeys:['(전체)'] };
  const keys = new Set([...Object.keys(base), ...Object.keys(local||{}), ...Object.keys(server||{})]);
  const merged = {}, conflictKeys = [];
  for (const k of keys) {
    const lc = !stableEqual((local||{})[k], base[k]);   // 로컬이 base 대비 변경?
    const sc = !stableEqual((server||{})[k], base[k]);  // 서버가 base 대비 변경?
    if (lc && sc && !stableEqual((local||{})[k], (server||{})[k])) { conflictKeys.push(k); merged[k] = (server||{})[k]; }
    else if (lc) merged[k] = (local||{})[k];
    else merged[k] = (server||{})[k];
  }
  return conflictKeys.length ? { status:'conflict', conflictKeys } : { status:'merged', data: merged };
}
```
- `DataService`로 노출(IIFE return 추가). 섹션 라벨은 `app.jsx`의 `SECTION_LABELS` 상수에서 표시용 매핑.

## 5. 테스트 매트릭스

| 그룹 | 케이스 | 검증 |
|------|--------|:----:|
| storage OCC | compute_rev 멱등(키순서 무관 동일) | rev 안정성 |
| | base_rev=현재 → 기록 성공, 새 rev 반환 | happy path |
| | base_rev≠현재 → ConflictError(current_rev 동반) | 충돌 검출 |
| | base_rev=None → 무조건 기록 | 폴백 호환 |
| server | GET /api/db ETag 헤더 존재 | rev 노출 |
| | POST If-Match 일치 → 200 {ok,rev} | 정상 |
| | POST If-Match 불일치 → 409 {error,rev} | 충돌 응답 |
| | POST If-Match 없음 → 200 기록 | 레거시 |
| data-service | resolveConcurrentEdit: identical / disjoint→merged / 동일섹션→conflict / base=null→conflict | 병합 판정 |
| | stableEqual: 객체 키순서 무관, 배열 순서 민감, 중첩 | 비교 정확성 |
| 회귀 | 기존 server/storage/settings/JS 테스트 GREEN | 무회귀 |

> server 테스트는 기존 `make_post_handler` 패턴(소켓 없이 `Handler.__new__` + BytesIO,
> `send_json` 스텁으로 status/payload/headers 캡처) 재사용. GET ETag는 `wfile` BytesIO로
> 헤더 캡처하거나 `send_json` 스텁 확장.

## 6. 다음 단계
→ 구현 → `/pdca analyze concurrent-edit-guard`
