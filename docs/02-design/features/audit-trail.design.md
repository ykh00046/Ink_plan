# Audit Trail Design Document

> **Plan**: `docs/01-plan/features/audit-trail.plan.md`
> **Project**: ink-plan · **Version**: 1.0.0 · **Author**: Hermes Planner (Claude) · **Date**: 2026-06-15 · **Status**: Approved

---

## 1. Architecture Overview

```
편집(view) ──▶ app.jsx autosave ──POST /api/db──▶ server.do_POST
   │              (X-Edit-Source: view)                │
   │                                                   ▼
   │                              storage.write_current_checked(data, base_rev, source)
   │                                   ├─ before = read_json(current.json)   ← OCC 재활용
   │                                   ├─ compute_rev/compare (기존 OCC)
   │                                   ├─ write_json_atomic(current.json)    ← 본 저장
   │                                   └─ append_audit(diff_audit(before, data), source)  ← best-effort
   │                                                   │
   ▼                                                   ▼
변경 이력 페이지 ◀──GET /api/audit──── data/db/audit.json  (append-only JSON 배열)
 (AuditPage)        (최신순, 상한 N)
```

핵심: **diff는 서버 저장 락 안에서 before/after로 추출**한다. concurrent-edit-guard의 OCC가 이미 `before = read_json(CURRENT_FILE)`를 락 안에서 읽으므로, 추가 I/O·경합 없이 그대로 재사용한다.

---

## 2. Data Model

### 2.1 Audit Entry (`data/db/audit.json` — JSON 배열, append-only)

```json
[
  { "ts": "2026-06-15T10:30:12", "field": "injection·3층·10호기·월·day",
    "before": "", "after": "PIA블루", "source": "injection" },
  { "ts": "2026-06-15T10:31:04", "field": "machineAssignments·PIA블루",
    "before": "10호기|", "after": "10호기|INK-001", "source": "machines" }
]
```

| Field | Type | 설명 |
|-------|------|------|
| `ts` | string | `datetime.now().isoformat(timespec="seconds")` (로컬, 초 단위) |
| `field` | string | `<domain>·<...key>` 가운데점(`·`) 구분 경로 |
| `before` | string\|null | 이전 값(없으면 `null`/`""`) |
| `after` | string\|null | 이후 값 |
| `source` | string | 편집 화면 식별자 (예: `injection`, `products`, `machines`, `web`) |

### 2.2 Field 경로 규약

| Domain | Flatten 키 | Value 요약 |
|--------|-----------|-----------|
| `injection` | `injection·{floor}·{machine}·{day}·{shift}` | 제품명 (빈 셀=`""`) |
| `products` | `products·{name}` | `"{brand}|{ink1,ink2,...}"` |
| `machineAssignments` | `machineAssignments·{ink}` | `"{machine}|{code}"` |

- `machine`은 `m.machine || m.name`, `ink`은 `a.ink || a.product || a.name`(구버전 호환, `inkOfAssignment` 규칙과 동일).
- `shift`는 원본 키(`day`/`night`) 유지 — UI에서 주간/야간으로 라벨링.

---

## 3. Backend Design (`scripts/storage.py`)

### 3.1 상수

```python
AUDIT_FILE = DB_DIR / "audit.json"
AUDIT_DOMAINS = ("injection", "products", "machineAssignments")
```

### 3.2 Flatten + diff (순수)

```python
def _audit_flatten(data):
    """injection/products/machineAssignments → {field: value_summary} 평탄화."""
    d = data or {}
    flat = {}
    # injection 셀
    for floor, machines in (d.get("injection") or {}).items():
        for m in (machines or []):
            machine = str((m or {}).get("machine") or (m or {}).get("name") or "")
            for day, shifts in ((m or {}).get("schedule") or {}).items():
                for shift, value in (shifts or {}).items():
                    if value:
                        flat[f"injection·{floor}·{machine}·{day}·{shift}"] = str(value)
    # products
    for p in (d.get("products") or []):
        name = str((p or {}).get("name") or "")
        if not name:
            continue
        brand = str((p or {}).get("brand") or "")
        inks = ",".join(str(i) for i in ((p or {}).get("inks") or []) if i)
        flat[f"products·{name}"] = f"{brand}|{inks}"
    # machineAssignments
    for a in (d.get("machineAssignments") or []):
        ink = str((a or {}).get("ink") or (a or {}).get("product") or (a or {}).get("name") or "").strip()
        if not ink:
            continue
        flat[f"machineAssignments·{ink}"] = f"{(a or {}).get('machine') or ''}|{(a or {}).get('code') or ''}"
    return flat

def diff_audit(before, after):
    """변경된 항목만 [{field, before, after}] 반환 (정렬 안정)."""
    b, a = _audit_flatten(before), _audit_flatten(after)
    out = []
    for key in sorted(set(b) | set(a)):
        bv, av = b.get(key), a.get(key)
        if bv != av:
            out.append({"field": key, "before": bv, "after": av})
    return out
```

### 3.3 append / read (락 + atomic)

```python
def read_audit(limit=None):
    with _LOCK:
        if not AUDIT_FILE.exists():
            return []
        try:
            entries = read_json(AUDIT_FILE)
        except (ValueError, OSError):
            return []          # 손상 시 빈 목록 (조회는 절대 throw 안 함)
        if not isinstance(entries, list):
            return []
        return entries[-limit:] if limit else entries

def append_audit(changes, source, ts=None):
    """changes(diff_audit 결과)를 audit.json에 append. 빈 변경은 무시. 추가 건수 반환."""
    if not changes:
        return 0
    ts = ts or datetime.now().isoformat(timespec="seconds")
    src = str(source or "")
    records = [{"ts": ts, "field": c["field"], "before": c["before"],
                "after": c["after"], "source": src} for c in changes]
    with _LOCK:
        existing = read_audit()
        existing.extend(records)
        write_json_atomic(AUDIT_FILE, existing)
    return len(records)
```

### 3.4 OCC 저장 경로 연동

```python
def write_current_checked(data, base_rev, source=None):
    with _LOCK:
        ensure_current()
        before = read_json(CURRENT_FILE)          # OCC가 읽던 현재본 = audit의 before
        cur = compute_rev(before)
        if base_rev is not None and base_rev != cur:
            raise ConflictError(cur)
        write_json_atomic(CURRENT_FILE, data)     # 본 저장 우선
        if source is not None:
            try:
                append_audit(diff_audit(before, data), source)   # best-effort (FR-08)
            except Exception:
                pass
        return compute_rev(data)
```

- `source=None`(기본)이면 audit 비기록 → **기존 단위 테스트/레거시 호출 무영향**.
- 본 저장이 성공한 뒤 append하므로, audit 실패가 커밋을 되돌리지 않는다.

---

## 4. API Design (`scripts/server.py`)

### 4.1 `GET /api/audit`

```python
if path == "/api/audit":
    try:
        limit = int((parse_qs(parsed.query).get("limit") or ["500"])[0])
    except (TypeError, ValueError):
        limit = 500
    limit = max(1, min(limit, 2000))
    entries = read_audit()
    self.send_json(list(reversed(entries))[:limit])   # 최신순 + 상한
    return
```

- `/api/*` 동일출처 가드(`is_api_request_allowed`) 적용.
- `audit.json`은 `/data/db/` 하위 → `BLOCKED_STATIC_PREFIX`로 정적 노출 이미 차단(추가 작업 불필요, 테스트로 확인).

### 4.2 `POST /api/db` (source 연동)

```python
source = self.headers.get("X-Edit-Source") or "web"
new_rev = write_current_checked(data, self._if_match_rev(), source=source)
```

- 헤더가 없어도 `"web"`으로 기록 → 모든 API 저장이 감사됨.
- import에 `read_audit` 추가.

---

## 5. Shared Logic (`data-service.js`, 순수 헬퍼)

```js
// "injection·3층·10호기·월·day" → {kind, kindLabel, target, detail}
function parseAuditField(field) { ... }      // UI 표시용 경로 파싱
function auditChangeKind(before, after) { ... } // 'added' | 'removed' | 'changed'
function summarizeAuditEntries(entries) { ... } // {total, byKind, bySource}
```

| Helper | 입력 | 출력 | 용도 |
|--------|------|------|------|
| `parseAuditField` | field 문자열 | `{kind, kindLabel, target, detail}` | 타임라인 행 라벨 |
| `auditChangeKind` | before, after | 추가/삭제/변경 | 상태 배지 톤 |
| `summarizeAuditEntries` | 엔트리 배열 | 집계 | 헤더 요약 |

- `kindLabel`: `injection`→`사출계획`, `products`→`제품 마스터`, `machineAssignments`→`잉크 배정`.
- 빈 값 판정: `null|undefined|''` → 비어있음.

---

## 6. UI Design (`pages/audit.jsx` — `AuditPage`)

- **레이아웃**: `기록 조회`와 동일한 `page` 패턴. 상단 요약(총 변경/도메인별), 툴바(도메인 필터 `Seg` + 검색 input + 새로고침), 본문은 **시간 역순 타임라인**.
- **로드**: `useEffect`에서 `GET /api/audit?limit=500`. 실패 시 `notify` + 빈 목록(읽기 안전).
- **행 표시**: `시각` · `상태 배지(추가/변경/삭제)` · `kindLabel · target (detail)` · `이전 → 현재` · `출처`.
- **필터**: 도메인(전체/사출/제품/잉크) + 텍스트 검색(field/before/after/source 부분일치).
- **출처 라벨**: view id → 한글 매핑(`injection`→`사출계획`, `machines`→`잉크 관리`, `products`→`제품 관리`, `web`→`기타`).
- `window.AuditPage = AuditPage`로 전역 등록.

### 6.1 NAV / 라우팅 / 로더

- `app.jsx` NAV `일일 작업` 그룹에 `기록 조회` 바로 뒤 `{ id: 'audit', label: '변경 이력', icon: 'history' }` 추가.
- `app.jsx` 라우팅 `{view === 'audit' && <AuditPage ctx={ctx} />}`.
- `app.jsx` 저장 헤더: `viewRef`로 현재 화면을 추적해 `X-Edit-Source`로 전송(autosave·충돌 재저장·강제 덮어쓰기 3경로 모두).
- `index.html`에 `pages/audit.jsx` 스크립트 등록.

---

## 7. Test Plan

| # | Test | Type | 검증 |
|---|------|------|------|
| T1 | `diff_audit` injection 셀 추가/변경/삭제 | Python | field 경로·before/after |
| T2 | `diff_audit` products/assignments 변경 | Python | 요약 문자열 diff |
| T3 | `diff_audit` 무변경 → 빈 결과 | Python | FR-03 |
| T4 | `append_audit`/`read_audit` 누적·최신순·손상격리 | Python | atomic, 손상 시 [] |
| T5 | `write_current_checked(source=)` 저장+audit, 실패격리 | Python | FR-08 |
| T6 | `GET /api/audit` 최신순·상한, 정적 차단 | Python(server) | FR-04, 보안 |
| T7 | `parseAuditField`/`auditChangeKind`/`summarizeAuditEntries` | Node | UI 순수 로직 |
| T8 | 브라우저: 편집→저장→타임라인 반영·필터·검색 | QA | FR-05~07 |

---

## 8. Traceability

| Plan FR | Design 반영 |
|---------|-------------|
| FR-01 | §3.2 `diff_audit` |
| FR-02 | §3.3 `append_audit`, §2.1 스키마 |
| FR-03 | §3.2 변경분만, §3.3 빈 무시 |
| FR-04 | §4.1 `/api/audit` 최신순·상한 |
| FR-05 | §6 AuditPage 타임라인 |
| FR-06 | §6 필터·검색 |
| FR-07 | §4.2 `X-Edit-Source`, §6.1 viewRef |
| FR-08 | §3.3 best-effort try/except |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-06-15 | Initial approved design | Hermes Planner (Claude) |
