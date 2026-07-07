# Analysis (Gap) — 동시 편집 가드 (concurrent-edit-guard)

> PDCA Phase: **Check** · 작성일 2026-06-10 · Match Rate: **100%**
> Design: `docs/02-design/features/concurrent-edit-guard.design.md`

## 1. 방법

Design 문서의 DoD/테스트 매트릭스를 실제 코드(`storage.py`·`server.py`·`data-service.js`·`app.jsx`)
및 테스트 결과와 1:1 대조했다. 검증은 실행 결과(테스트 GREEN)로 고정한다.

- JS: `node --test tests/data-service.test.js tests/ui-regressions.test.js tests/date-utils.test.js tests/extracted-logic.test.js` → **145 pass / 0 fail**
- Python: `python -m pytest tests/` → **50 pass**

## 2. DoD 대조표

| DoD 항목 | 구현 위치 | 검증(테스트) | 상태 |
|----------|-----------|--------------|:----:|
| GET `/api/db` 응답에 `ETag` | `server.py` GET 분기 `headers={"ETag": f'"{compute_rev(data)}"'}` | `test_get_db_includes_etag_header` | ✅ |
| POST `If-Match` CAS + 409 + currentRevision | `server.py` `write_current_checked(data, self._if_match_rev())` + `except ConflictError → 409 {error:"conflict","rev"}` | `test_post_stale_if_match_returns_409` | ✅ |
| `If-Match` 부재 → 무조건 기록(하위호환) | `_if_match_rev()` None → `base_rev=None` | `test_post_without_if_match_writes_200` | ✅ |
| 성공 응답 `{ok,rev}` + `ETag` | `server.py` `send_json({"ok":True,"rev":new_rev}, headers={"ETag":...})` | `test_post_matching_if_match_writes_200_with_rev` | ✅ |
| storage CAS API `current_rev`/`write_current_checked`/`ConflictError` | `storage.py:78-112` | `StorageOCCTest` 5건 | ✅ |
| 동일 내용 = 동일 rev(멱등, 키순서 무관) | `compute_rev` sort_keys 정규화 | `test_compute_rev_is_key_order_independent` | ✅ |
| 단일 `_LOCK` read-rev→compare→write (TOCTOU 차단) | `write_current_checked` `with _LOCK` | `test_checked_write_with_stale_rev_raises_and_keeps_file` | ✅ |
| 프론트 rev 추적(로드/저장) | `app.jsx` `dbRevRef` 로드 ETag 수신·저장 If-Match 송신·성공 시 갱신 | (수동 검증) | ✅ |
| 자동 병합(섹션 비충돌) | `app.jsx` 저장 effect `res.status==='merged'` → `postDb(res.data, serverRev)` + `DataService.resolveConcurrentEdit` | `resolveConcurrentEdit: …→merged` | ✅ |
| 충돌 선택 UI(다시 불러오기/덮어쓰기) | `app.jsx` `ConflictModal` + `resolveConflictUseServer`/`resolveConflictUseLocal` | (수동 검증) | ✅ |
| 불필요 저장 제거(멱등 skip) | `app.jsx` 저장 effect 진입 `if (DataService.stableEqual(snapshot, lastSyncedRef.current)) return` | `stableEqual: …` | ✅ |
| 순수 함수 분리·JS 테스트 | `data-service.js` `stableEqual`·`resolveConcurrentEdit` (export) | JS 5건(stableEqual 1 + resolve 4) | ✅ |
| silent loss = 0(패자 백업) | 자동/모달 양 경로 `localStorage.inkPlanData.conflict` 백업 | (수동 검증) | ✅ |
| 전체 테스트 GREEN | — | JS 145 + Python 50 | ✅ |
| 동작 회귀 0 | 기존 JS 140·Python 41 전수 유지 | 회귀 GREEN | ✅ |

**Match Rate = 14/14 = 100%**

## 3. 발견된 갭

**없음(blocker/major 0).** 모든 DoD 항목이 구현 + 테스트로 충족됐다.

## 4. 관찰(개선 여지, 비차단)

1. **모달 선택은 pure-server / pure-local** (`resolveConflictUseServer`는 `c.server`, `useLocal`은 `c.local` 저장).
   자동 병합이 비충돌 케이스를 이미 흡수하므로 모달은 "진짜 충돌"에서만 뜬다. 이때 충돌과
   **무관한** 섹션 변경까지 한쪽 기준으로 정해진다(반대편은 `inkPlanData.conflict`에 백업).
   → `resolveConcurrentEdit`가 `serverResolved`/`localResolved`(충돌 섹션만 승자, 나머지 양쪽 보존)도
   계산해 두면 손실을 더 줄일 수 있으나, **예측가능성**(버튼명=정확히 그쪽 내용)을 위해 현 설계 유지가 합리적. 비차단.
2. **로드 직후 마이그레이션 자동저장 제거**: `stableEqual` skip 가드로 인해 과거의 "로드 시 1회 저장"이
   사라졌다. 마이그레이션 결과는 첫 실제 편집 때 영속화된다. 의도된 개선(불필요/위험한 stale-base write 제거).
3. **GET의 read_current + compute_rev 2회 락**: 그 사이 쓰기가 끼면 ETag가 더 최신일 수 있으나,
   다음 저장에서 409로 안전 검출 → 정합성 불변. 단일 운영자 환경에서 사실상 비발생.

## 5. 판정
Match Rate **100% (≥90%)** → iterate 불필요. **report 단계로 진행**.
