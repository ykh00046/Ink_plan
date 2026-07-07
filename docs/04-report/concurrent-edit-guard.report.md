# Report — 다중 탭 동시편집 가드 (concurrent-edit-guard)

> PDCA 완료 보고 · 2026-06-10 · Level: Dynamic · Match Rate **100%**

## 1. 한 줄 요약
`POST /api/db`의 무조건 덮어쓰기로 인한 **다중 탭 lost-update**를 ETag(content-hash) 기반
낙관적 동시성 제어(OCC)로 차단하고, 충돌 시 **무손실 자동 병합 + 사용자 선택 모달 +
패자 백업**으로 silent loss를 0으로 만들었다.

## 2. 문제 → 해결

| | Before | After |
|---|--------|-------|
| 서버 쓰기 | `write_current` 무조건 덮어쓰기 | `write_current_checked(data, base_rev)` — rev 일치 시에만 기록 |
| 버전 토큰 | 없음 | GET `ETag`, POST `If-Match`, 응답 `{ok,rev}` |
| 충돌 | 조용히 소실 | 409 → 3-way 판정: 자동 병합 / 선택 모달 |
| 데이터 손실 | 경고 없이 발생 | 패자 후보 `inkPlanData.conflict` 백업 + 토스트 |
| 불필요 저장 | 로드/리로드마다 POST | `stableEqual` skip 가드로 멱등 수렴 |

## 3. 변경 파일

| 파일 | 변경 |
|------|------|
| `scripts/storage.py` | `ConflictError`·`compute_rev`·`current_rev`·`write_current_checked` 추가 (`write_current` 불변) |
| `scripts/server.py` | `send_json(headers=…)`·`_if_match_rev`·GET ETag·POST CAS·409 매핑 |
| `data-service.js` | 순수 함수 `stableEqual`·`resolveConcurrentEdit`(status: identical/merged/conflict) 추가·export |
| `app.jsx` | `dbRevRef`·`lastSyncedRef`·`conflictState`, 저장 effect OCC 흐름, `ConflictModal`, skip 가드, APP_REV 57 |
| `index.html` | `data-service.js?v=61`·`app.jsx?v=61` 캐시 버전 |
| `tests/storage_test.py` | OCC 5건 |
| `tests/server_test.py` | OCC 4건 + GET 헤더 캡처 헬퍼 |
| `tests/data-service.test.js` | OCC 순수 함수 5건 |
| `tests/qa_concurrent_edit_guard.py` | 실서버 통합 QA(신규) |

## 4. 검증 결과
- **JS**: 145 pass (140 → +5, 회귀 0)
- **Python**: 50 pass (41 → +9, 회귀 0)
- **실서버 통합 QA**: 13/13 PASS (실제 HTTP: ETag/If-Match/409/폴백 전 경로)
- **Match Rate**: 100% (gap-detector 14/14)

## 5. 설계 핵심 결정
1. **content-hash 리비전** — 카운터 파일·데이터 모델 필드 없이 재시작/복원 안정, 동일 내용=동일 rev(멱등).
2. **단일 `_LOCK` read→compare→write** — TOCTOU 차단(서버측 진짜 원자성).
3. **섹션 단위 3-way 병합** — 서로 다른 페이지 편집(다중 탭의 정상 케이스)은 무손실 자동 병합, 같은 섹션 충돌만 사용자 선택.
4. **If-Match 부재 = 무조건 기록** — 시드 폴백·레거시 호환(프론트는 항상 전송).
5. **skip 가드** — 모든 해소 경로가 `lastSyncedRef`를 방금 적용한 값에 맞춰 저장 폭주/자기충돌 0.

## 6. 한계 & 후속
- 프론트 React 통합(409→모달 렌더→클릭)은 자동 UI 테스트 미적용 — 순수 함수(JS) + 서버 QA + 코드 리뷰 3중 검증으로 대체(프로젝트 무 UI-하니스 관례).
- 필드(셀) 단위 머지/CRDT, 실시간 동기화(WebSocket)는 범위 외.
- 남은 backend-hardening 후속: **`seed-via-api`**(clean.json 완전 비노출 — `/api/seed` 신설 + 폴백 전환).

## 7. 배운 점
- 전체 스냅샷 저장 모델에서도 **버전 토큰 1개**(ETag)만 흘리면 표준 OCC로 lost-update를 정합하게 막을 수 있다.
- content-hash rev는 멱등성을 공짜로 줘서, "충돌 후 reload→재저장" 루프가 자연 수렴한다(별도 디바운스·플래그 불필요).
- 충돌 UX의 핵심은 "자동 머지로 진짜 충돌을 최소화"하고, 남은 충돌은 **예측 가능한 전체 단위 선택 + 패자 백업**으로 신뢰를 주는 것.
