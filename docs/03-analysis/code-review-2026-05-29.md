# Code Review Report — 2026-05-29

대상 범위: `8b3c50c`(세션 시작) → 작업트리 현재
검토 도구: bkit code-analyzer (confidence-based filtering)
선행: [code-review-2026-05-19.md](./code-review-2026-05-19.md)

## Summary

- 검토 파일: 11 (pages 6 · scripts 2 · data-service.js · app.jsx · styles.css) + 테스트 3
- 발견 이슈: **Critical 0 · Major 0 · Minor 2(비차단) · Info 다수**
- 테스트: JS 60/60, Python 5/5 통과
- 브라우저 QA: cascade 열기/검색/선택, test-inks 수정 저장, machines 인라인 편집, Origin 가드(403) — 전부 통과
- **판정: SHIP**

## 변경 3그룹

### GROUP A — 하드닝 수정 (회귀 없음)
| 파일 | 변경 | 검증 |
|------|------|------|
| `scripts/server.py` | `is_api_request_allowed()` — /api/* Host·Origin allowlist (CSRF·DNS rebinding 차단) | exact-match라 `127.0.0.1:8765.evil.com` 우회 불가, 동일출처 요청 정상 |
| `scripts/storage.py` | `prune_backups()` 라벨 인지형 — startup 20개·중요 90개 | before_restore/manual/scheduled는 important로 분류, 조기 방출 없음 |
| `pages/test-inks.jsx` | `handleSave` — `_origName` 기준 행 탐색(기존 `indexOf` 항상 -1) | rename 시에도 정확 행 갱신, 중복 미생성 |
| `pages/products.jsx` | handleSave/handleDelete — `p.name`(PK) 기준 | 배열 재생성 대비 안전, renameInjectionRefs 연동 정상 |
| `pages/machines.jsx` | 인라인 호기 편집 — 객체참조(`editingIdx===a`) 기준 | 필터가 참조 보존해 desync 없음 |
| `pages/inventory.jsx` | `handleBulkAdd` O(n²)→id→lot Map | 삽입 순서(동일잉크 마지막 위치) 의미 보존 |

### GROUP B — cascade 드롭다운 (WIP `83ada2a`, 브라우저 QA 통과)
- `data-service.js`: `buildInkMaster`/`isInkInMaster` 순수 함수 — 정규화·dedup·정렬 정상
- `pages/products.jsx` `InkSlotInput`: datalist → 포털 검색 선택기(자유입력 차단)
- `pages/review.jsx`: `buildInkMaster` 재사용으로 inline 중복 제거

### GROUP C — cascade Minor 픽스 (브라우저 검증: 스크롤 시 -200px 추종)
- `pages/products.jsx` `InkSlotInput`: open 동안 window scroll(capture)·resize 리스너로 `recomputePos()` → fixed 팝오버가 트리거 버튼 추종

## 잔여 Minor (비차단)

1. **server.py** — 빈 `Host` 헤더는 통과(`if host and ...`). HTTP/1.1이 Host를 강제하고 127.0.0.1 바인딩이라 악용 불가. 견고화 시 빈 Host 거부.
2. **products.jsx GROUP C** — `recomputePos`는 매 렌더 재정의되나, effect deps가 `[open]`이라 add/remove가 동일 effect 클로저 인스턴스를 공유 → **누수/불일치 없음**. live ref/setPos를 읽으므로 동작도 정상.

## 결론

이번 세션 변경은 신규 결함 없이 (1) 보안(CSRF/rebinding) (2) 편집 정확성 버그 (3) 성능(O(n²))을 교정했고, cascade 신규 기능은 순수 함수 추출·포털 UI·스크롤 추종까지 건전. 배포 가능.
