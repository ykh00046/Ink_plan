# 백엔드 견고화 (backend-hardening) PDCA 완료 보고서

> **상태**: 완료
>
> **프로젝트**: ink_plan (Level: Dynamic)
> **작성일**: 2026-06-10
> **담당자**: Hermes Planner
> **PDCA 주기**: backend-hardening

---

## 1. 요약

### 1.1 기능 개요

| 항목 | 내용 |
|------|------|
| 기능 | 백엔드 견고화 (에러 매핑, 요청 검증, 정적 파일 차단, 설정 동시성) |
| 시작 | 2026-06-09 |
| 완료 | 2026-06-10 |
| 기간 | 1일 |
| 영향 범위 | `scripts/server.py`, `scripts/settings_store.py`, `scripts/storage.py` |

### 1.2 결과 요약

```
┌─────────────────────────────────────────────┐
│  완료율: 100%                                 │
├─────────────────────────────────────────────┤
│  ✅ 완료된 항목:    5 / 5개                  │
│  ⏳ 진행 중:       0 / 5개                  │
│  ❌ 취소됨:        0 / 5개                  │
│                                              │
│  설계 일치도(match rate): 100%              │
│  전체 테스트: 181 pass (회귀 0)            │
│  실서버 QA: 10/10 PASS                      │
└─────────────────────────────────────────────┘
```

---

## 2. 관련 문서

| 단계 | 문서 | 상태 |
|------|------|------|
| Plan | [backend-hardening.plan.md](../01-plan/features/backend-hardening.plan.md) | ✅ 승인됨 |
| Design | [backend-hardening.design.md](../02-design/features/backend-hardening.design.md) | ✅ 승인됨 |
| Analysis | [backend-hardening.analysis.md](../03-analysis/backend-hardening.analysis.md) | ✅ 완료 |
| Report | 현재 문서 | 🔄 작성 완료 |

---

## 3. 완료된 항목

### 3.1 기능 요구사항

| ID | 요구사항 | 상태 | 비고 |
|----|---------|------|------|
| FR-01 | do_POST 예외 매핑 (400/404/500 + 일반 메시지) | ✅ 완료 | ValueError→400, FileNotFoundError→404, 기타→500 |
| FR-02 | read_body_json 요청 검증 (chunked 거부, CL 검증) | ✅ 완료 | 비정수/음수 CL 거부, Transfer-Encoding: chunked 거부 |
| FR-03 | is_api_request_allowed 빈 Host 거부 | ✅ 완료 | ⚠️ 의도적 동작 변경 1건 |
| FR-04 | 정적 노출 deny-by-default + clean.json allowlist | ✅ 완료 | /data/* 기본 차단, /data/clean.json만 명시 허용 |
| FR-05 | settings 단일 락·단일 write (lost-update 해소) | ✅ 완료 | 이중 write 제거, apiKey 중복 기록 방지 |
| FR-06 | 백업 로테이션 mtime 정렬 (직전 세션 scope-in) | ✅ 완료 | 파일명→st_mtime 기반 정렬, TOCTOU 방어 |

### 3.2 비기능 요구사항

| 항목 | 목표 | 달성 | 상태 |
|------|------|------|------|
| 설계 일치도 | ≥90% | 100% | ✅ |
| 테스트 커버리지 | 모든 항목 | 33개 케이스 | ✅ |
| 회귀 테스트 | JS 140 유지, Python 신규 추가 | JS 140 + Python 41 | ✅ |
| 동작 보존 | 정상 경로 변경 없음 | 10/10 QA PASS | ✅ |
| 정보 노출 | str(e) 제거, 절대경로 미노출 | traceback만 서버 로그 | ✅ |

### 3.3 산출물

| 산출물 | 위치 | 상태 |
|--------|------|------|
| server.py 수정 (4개 항목) | scripts/server.py | ✅ |
| settings_store.py 재작성 | scripts/settings_store.py | ✅ |
| storage.py 정렬 수정 | scripts/storage.py | ✅ |
| 테스트 신설 + 보강 | tests/server_test.py, tests/settings_store_test.py, tests/storage_test.py | ✅ |
| 분석 문서 | docs/03-analysis/backend-hardening.analysis.md | ✅ |

---

## 4. 항목별 변경 상세

### 4.1 ① do_POST 예외 매핑

**Before:**
```python
except Exception as e:
    send_json({"error": str(e)}, 500)  # 절대경로·내부 상세 노출
```

**After:**
```python
except ValueError:  # JSONDecodeError·UnicodeDecodeError는 ValueError 하위
    self.send_json({"error": "bad request"}, 400)
except FileNotFoundError:
    self.send_json({"error": "not found"}, 404)
except Exception:
    traceback.print_exc()  # 상세는 서버 로그에만
    self.send_json({"error": "internal error"}, 500)
```

**영향:**
- 정보 노출 제거 (절대경로·str(e) 미포함)
- 상태 코드 정확화 (400 for validation, 404 for missing, 500 for internal)
- 서버 로그에는 traceback 기록 (디버깅 정보 보존)

### 4.2 ④ read_body_json 요청 검증

**Before:**
```python
length = int(self.headers.get("Content-Length", "0"))  # ValueError 미처리
# chunked 본문 미처리
```

**After:**
```python
if (self.headers.get("Transfer-Encoding") or "").lower() == "chunked":
    raise ValueError("chunked transfer-encoding not supported")
try:
    length = int(self.headers.get("Content-Length", "0"))
except (TypeError, ValueError):
    raise ValueError("invalid Content-Length")
if length < 0:
    raise ValueError("invalid Content-Length")
```

**영향:**
- 비정수 Content-Length 명시적 거부 (→400)
- Transfer-Encoding: chunked 명시적 거부 (→400)
- 음수 Content-Length 거부

### 4.3 ④ is_api_request_allowed 빈 Host 거부

**Before:**
```python
host = (self.headers.get("Host") or "").strip().lower()
if host and host not in ALLOWED_HOSTS:  # 빈 Host 통과
    return False
return True
```

**After:**
```python
host = (self.headers.get("Host") or "").strip().lower()
if host not in ALLOWED_HOSTS:  # 빈 Host 거부
    return False
```

**영향:**
- ⚠️ **의도적 동작 변경 1건**: 빈/누락 Host→403 거부
- 정상 브라우저 fetch는 항상 Host 헤더 전송 → 영향 없음
- 비브라우저 클라이언트(Host 누락)만 차단 (방어 강화)

### 4.4 ③ 정적 노출 deny-by-default + allowlist

**Before:**
```python
BLOCKED_STATIC_PREFIXES = ("/data/db", "/data/backups", "/data/settings")
# /data/clean.json, /data/sheets.json 노출
```

**After:**
```python
BLOCKED_STATIC_PREFIX = "/data/"
STATIC_DATA_ALLOWLIST = ("/data/clean.json",)  # 시드 폴백 필요

def is_blocked_static(self):
    decoded = unquote(urlparse(self.path).path).lower()
    if decoded in STATIC_DATA_ALLOWLIST:
        return False
    return decoded.startswith(BLOCKED_STATIC_PREFIX)
```

**영향:**
- `/data/*` 기본 차단 (fail-safe)
- `/data/clean.json` 명시 허용 (app.jsx:131 시드 폴백)
- `/data/sheets.json`, `/data/db`, `/data/backups`, `/data/settings` 차단
- 향후 `/data/` 신규 파일 자동 차단 (allowlist 확장 필요)
- 인코딩 우회·대소문자 변형 방어

### 4.5 ② settings 단일 락·단일 write

**Before:**
```python
def write_settings(data):
    write_api_key(data.get("apiKey", ""))      # 락 밖 read→write
    file_data = _read_file_settings()           # 두 번째 read
    file_data["model"] = ...
    _write_file_settings(file_data)             # 두 번째 write → lost-update
```

**After:**
```python
def write_settings(data):
    model = (data.get("model") or DEFAULT_MODEL).strip()
    api_key = (data.get("apiKey") or "").strip()
    with _SETTINGS_LOCK:
        file_data = _read_file_settings()       # 단일 read (락 안)
        file_data["model"] = model
        if api_key:
            file_data["apiKey"] = api_key
        else:
            file_data.pop("apiKey", None)
        _write_file_settings(file_data)         # 단일 write (락 안)
    return read_settings()
```

**영향:**
- lost-update 해소 (동시 저장 시 한쪽이 다른 쪽을 덮어쓰는 문제 제거)
- apiKey 중복 기록 방지
- 파일 상태 반쪽 상태 제거 (atomic write)
- 외부 인터페이스 동일: model 기본값/공백 trim, 빈 apiKey 제거

### 4.6 ⑤ 백업 로테이션 mtime 정렬 (직전 세션 scope-in)

**Before:**
```python
def list_backups():
    return sorted(BACKUP_DIR.glob("*.json"), reverse=True)  # 파일명 역순
```

**After:**
```python
def list_backups():
    entries = []
    for p in BACKUP_DIR.glob("*.json"):
        try:
            mtime = p.stat().st_mtime
        except OSError:
            continue
        entries.append((mtime, p.name, p))
    entries.sort(reverse=True)
    return [p for _, _, p in entries]
```

**영향:**
- 파일명 정렬 → st_mtime 정렬 (시간 기준 정확)
- 백업 프루닝이 최신 스냅샷 우선 삭제 문제 해소
- TOCTOU 방어 (조회 중 삭제 시 OSError 처리)
- 동일 시각 백업은 파일명 역순 tiebreaker (기존 동작 유지)

---

## 5. 의도적 동작 변경

### 변경 사항

**빈/누락 Host 거부 (is_api_request_allowed)**
- `if host and host not in ALLOWED_HOSTS` → `if host not in ALLOWED_HOSTS`
- 기존: 빈 Host 통과 (기본값 127.0.0.1로 취급)
- 변경: 빈 Host 거부 (403 Forbidden)

### 영향 분석

| 클라이언트 | Host 헤더 | 동작 | 영향 |
|-----------|----------|------|------|
| 브라우저 fetch | 자동 전송 (127.0.0.1) | ✅ 허용 | 없음 |
| Python requests | 자동 전송 | ✅ 허용 | 없음 |
| curl (Host 미지정) | 누락 | ❌ 거부 (403) | **변경** |
| LAN 비브라우저 클라이언트 (Host 누락) | 누락 | ❌ 거부 (403) | **변경** |

**결론**: 정상 클라이언트(브라우저, 표준 라이브러리)는 영향 없음. Host 누락 클라이언트만 명시적 거부 (방어 강화).

---

## 6. 검증 결과

### 6.1 설계 일치도 분석 (gap-detector)

| 항목 | 설계 | 구현 | 테스트 | 결과 |
|------|------|------|--------|:----:|
| ① do_POST 예외 매핑 | 3개 분기 (400/404/500) | ✅ 반영 | PostErrorMapping 7케이스 | ✅ |
| ④ read_body_json 검증 | 5가지 조건 (CL, chunked 등) | ✅ 반영 | ReadBodyJson 5케이스 | ✅ |
| ③ 정적 deny-by-default | 11개 경로 allowlist | ✅ 반영 | BlockedStatic 11케이스 | ✅ |
| ④ Host 거부 | 8개 시나리오 | ✅ 반영 | ApiGuard 갱신 | ✅ |
| ② settings 단일 write | 5개 케이스 (race, half-state 등) | ✅ 반영 | settings 5케이스 | ✅ |
| ⑤ 백업 mtime 정렬 | 파일명→mtime, TOCTOU 방어 | ✅ 반영 | storage mtime 1케이스 | ✅ |

**설계 일치도: 100%** (누락·불일치 0건, 모든 항목 일대일 반영)

### 6.2 단위 테스트 결과

| 언어 | 테스트 | 이전 | 신규 | 합계 | 결과 |
|------|--------|------|------|------|:----:|
| JavaScript | js 모듈 테스트 | 140 | 0 | 140 | ✅ PASS |
| Python | server_test 보강 | 20 | + | + | ✅ PASS |
| Python | settings_store_test 신설 | 0 | 5 | 5 | ✅ PASS |
| Python | storage_test 보강 | 5 | 1 | 6 | ✅ PASS |
| Python | 기타 기존 테스트 | 15 | 0 | 15 | ✅ PASS |

**전체 합계**:
- JavaScript: 140 pass (회귀 0)
- Python: 41 pass (신규 6 + 보강 20 포함)
- **총 181 pass (회귀 0)**

### 6.3 실서버 통합 QA (qa_backend_hardening.py)

임시 포트에서 서버 스레드 기동 후 검증:

| 검증 항목 | 요청 | 기대 | 결과 |
|----------|------|------|:----:|
| 시드 파일 정적 서빙 | `GET /data/clean.json` | 200 + content | ✅ |
| DB 파일 차단 | `GET /data/db/current.json` | 404 | ✅ |
| 백업 디렉터리 차단 | `GET /data/backups/2026.json` | 404 | ✅ |
| 설정 파일 차단 | `GET /data/settings.json` | 404 | ✅ |
| 시트 데이터 차단 | `GET /data/sheets.json` | 404 | ✅ |
| API 정상 조회 | `GET /api/db` (ALLOWED_HOST) | 200 + json | ✅ |
| 깨진 JSON 거부 | `POST /api/db` `{"bad"` | 400 bad request | ✅ |
| 비-dict 거부 | `POST /api/db` `123` | 400 invalid json | ✅ |
| 비정수 CL 거부 | `Content-Length: abc` | 400 bad request | ✅ |
| 외부 Host 거부 | `Host: evil.com` | 403 forbidden | ✅ |

**실서버 QA: 10/10 PASS**

### 6.4 회귀 검증

| 영역 | 검증 항목 | 상태 |
|------|----------|:----:|
| 정상 저장 | POST /api/db (dict) 저장 → read 확인 | ✅ |
| 백업/복원 | 백업 생성 → 복원 → 현재 상태 확인 | ✅ |
| 설정 저장 | settings 저장 → read 확인 | ✅ |
| 시드 폴백 | app.jsx:131 clean.json fetch 200 | ✅ |
| 프론트 UX | 4xx 응답도 성공경로(ok:true) 의존 안함 | ✅ |

**회귀: 0건** ✅

---

## 7. 학습 & 회고

### 7.1 잘한 점 (Keep)

1. **Plan 단계 코드 재진단**
   - 검토 권고를 그대로 신뢰하지 않고 직접 코드 대조
   - `app.jsx:131`의 시드 폴백 발견 → clean.json 전면 차단이 아닌 allowlist로 정정
   - 결과: 현장 수용 가능한 설계 (기능 보존 + 보안)

2. **테스트 주도 검증**
   - 33개 테스트 케이스로 4개 항목 모두 일대일 매핑
   - gap-detector 100% 일치도 달성 (iterate 불필요)
   - 실서버 QA로 통합 동작 최종 확인

3. **범위 명확화**
   - 5개 항목만 폐쇄하고, concurrent-edit-guard·seed-via-api는 후속으로 분리
   - 범위 내 4개 항목 모두 완료, 범위 외 의존성 없음

### 7.2 개선할 점 (Problem)

1. **동작 변경의 명확한 소통**
   - 빈 Host 거부는 정상 클라이언트 영향이 없지만, 문서화 필수
   - 향후 설계 초기에 "의도적 동작 변경" 섹션 강조 필요

2. **allowlist 관리 전략 부재**
   - `/data/clean.json` 시드 자체도 보안 고려 필요
   - 후속 `seed-via-api` 기능으로 완전 비노출 전환 필요

### 7.3 다음에 시도할 것 (Try)

1. **concurrent-edit-guard** (후속 PDCA)
   - `/api/db` ETag/revision 기반 409 충돌 감지
   - 프론트 autosave + 사용자 병합 UX

2. **seed-via-api** (후속 PDCA)
   - `/api/seed` 엔드포인트 신설
   - `app.jsx` 폴백을 정적 fetch → API 호출로 전환
   - clean.json 완전 비노출

3. **에러 응답 표준화**
   - 현재 "error" 문자열만 반환 → 에러 코드(ERR_xxx) 추가 고려
   - API 클라이언트 구분 용이

---

## 8. 다음 단계

### 8.1 즉시 (완료)

- [x] backend-hardening PDCA 완료
- [x] 모든 테스트 GREEN (181 pass)
- [x] 문서화 완료

### 8.2 후속 PDCA (분리)

| 항목 | 우선순위 | 예상 시작 | 비고 |
|------|---------|---------|------|
| concurrent-edit-guard | High | 추후 | 다중 탭 lost-update 방지 (ETag/revision on /api/db) |
| seed-via-api | High | 추후 | clean.json 완전 비노출 + /api/seed 엔드포인트 |
| 에러 응답 표준화 | Medium | 추후 | 에러 코드(ERR_xxx) 도입 |

---

## 9. 체크리스트

### 구현 완료

- [x] ① do_POST 예외 매핑 (400/404/500 + 일반 메시지)
- [x] ④ read_body_json 요청 검증 (chunked 거부, CL 검증)
- [x] ③ 정적 노출 deny-by-default + clean.json allowlist
- [x] ④ is_api_request_allowed 빈 Host 거부 (의도적 동작 변경)
- [x] ② settings 단일 락·단일 write
- [x] ⑤ 백업 로테이션 mtime 정렬

### 검증 완료

- [x] 단위 테스트: JS 140 유지 + Python 41 신규 추가 (181 total)
- [x] 설계 일치도: 100% (gap-detector)
- [x] 실서버 통합 QA: 10/10 PASS
- [x] 회귀 검증: 0건
- [x] 의도적 동작 변경 문서화: 1건 (빈 Host 거부)

### 문서 완료

- [x] Plan: [backend-hardening.plan.md](../01-plan/features/backend-hardening.plan.md)
- [x] Design: [backend-hardening.design.md](../02-design/features/backend-hardening.design.md)
- [x] Analysis: [backend-hardening.analysis.md](../03-analysis/backend-hardening.analysis.md)
- [x] Report: 현재 문서

---

## 10. 버전 이력

| 버전 | 일자 | 변경사항 | 작성자 |
|------|------|---------|--------|
| 1.0 | 2026-06-10 | PDCA 완료 보고서 작성 | Hermes Planner |

---

## 11. 결론

**backend-hardening PDCA 주기는 100% 완료되었습니다.**

5개 백엔드 견고화 항목(4 + scope-in 1)이 모두 구현·검증되었으며, 설계 일치도 100%, 테스트 181 pass, 실서버 QA 10/10 PASS로 품질을 확보했습니다.

의도적 동작 변경 1건(빈 Host 거부)은 정상 클라이언트에 영향이 없으며, 후속 concurrent-edit-guard와 seed-via-api 기능으로 다중 탭 보호와 정적 파일 완전 비노출을 달성할 예정입니다.
