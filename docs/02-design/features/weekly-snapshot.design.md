# 주간 마감 스냅샷 (Weekly Snapshot) — 설계

> 로드맵 Phase 2의 키스톤. 단일 스냅샷 저장 모델의 한계(과거 조회·추세·예측 불가)를
> 여는 최대 레버리지. 이 문서는 **저장 기반(완료)**과 **소비 계층(잔여)**을 구분한다.

## 1. 문제
현재 저장은 `current.json` 단일 스냅샷 + 감사 로그뿐. 과거 어느 주의 계획/재고를 그대로
재현할 방법이 없어 **History 조회가 보류**됐고, 소비 추세·수요 예측의 입력 데이터도 없다.
감사 로그 replay는 비싸고 부정확(마스터 변경까지 얽힘).

## 2. 접근
매주 마감 시 그 주 상태를 **불변(immutable) 전체 스냅샷**으로 아카이브한다.
- **키**: ISO 주차 `YYYY-Www` — 프론트 `getWeekInfo().isoLabel`과 동일 규약(단일 출처).
- **범위**: 전체 `data` 스냅샷 저장. 섹션만 고르지 않는 이유 = 과거 재현의 정확성(그 주의
  마스터까지)이 중요하고, 소규모 데이터라 단순·정확이 저장공간보다 우선(52주 × ~2MB ≈ 100MB/년, PC에서 무리 없음).
- **멱등**: 같은 주 재마감은 덮어씀 — 마감 버튼을 여러 번 눌러도 안전.
- **위치**: `data/archive/YYYY-Www.json` (gitignore, `/data/` 정적 차단 트리 → `/api/*`로만 접근).

## 3. 완료 — 저장 기반 + API (이 커밋)
- `storage.py`: `write_week_snapshot(week, data=None)` / `list_week_snapshots()` /
  `read_week_snapshot(week)`. 라벨 정규식 `^\d{4}-W\d{2}$` 검증(경로 traversal 차단), 원자적 쓰기.
- `server.py`:
  - `POST /api/snapshot` body `{week, data?}` → 적재(data 없으면 현재 DB). 잘못된 주 400.
  - `GET /api/snapshots` → 목록(최신순).
  - `GET /api/snapshot?week=YYYY-Www` → 읽기(부재 404, 잘못된 주 400).
- 테스트: storage 5 + server 3 케이스(적재·목록·읽기·멱등·라벨검증·부재). CI 게이트 포함.

## 4. 잔여 — 소비 계층 (다음 PDCA, 사용자 승인 후)
1. **주간 마감 트리거 (UI)**: 헤더/대시보드에 "이번 주 마감" 버튼 → `POST /api/snapshot`으로
   현재 `data`를 그 주 라벨로 적재. 확인 모달 + 성공 토스트. (자동 롤오버는 후속.)
2. **History 조회 부활**: 보류됐던 헤더 날짜 picker를 스냅샷 목록 기반으로 재구성. 선택 주의
   스냅샷을 read-only로 로드해 사출계획·잉크계획·재고를 그 주 그대로 표시.
   기존 `compareHistoryRows`(이미 있음)로 주 간 diff 재활용.
3. **추세 입력**: 주별 스냅샷에서 잉크 소비량 시계열 추출 → Phase 4(재발주점·수요예측) 입력.

## 5. 결정/주의
- 마스터(products/machineAssignments)까지 통째로 저장 → 과거 제품명·잉크구성이 그 시점 그대로.
- 스냅샷은 **읽기 전용 재현**용. 과거 스냅샷으로 현재 DB를 되돌리는 것은 별개(복원=기존 백업 경로).
- 아카이브 로테이션은 두지 않음(주간이라 성장 느림). 필요 시 후속에서 보존 정책 추가.
- inventory `daily`는 여전히 무한 누적 — 이는 별도 항목(로드맵 Phase 0 `inventory.daily 아카이브`)에서 처리.
