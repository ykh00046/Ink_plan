# Test Plan: history-snapshot-diff

> **Date**: 2026-06-15
> **Feature**: history-snapshot-diff
> **Design Doc**: `docs/02-design/features/history-snapshot-diff.design.md`

---

## 1. Test Scope

### In Scope

- 행 비교 코어의 네 상태 판정
- 기존 백업 API 계약
- 백업 선택, 변화 요약, 변경 필터, 이전/현재 표시
- 읽기 전용 데이터 흐름과 회귀

### Out of Scope

- 백업 복원
- 백업 보존 정책
- 제품 및 마스터 전체 diff

## 2. Test Items

### L1: Unit Tests

| ID | Target | Description | Priority |
|----|--------|-------------|----------|
| L1-001 | compare core | unchanged 판정 | P0 |
| L1-002 | compare core | added 판정 | P0 |
| L1-003 | compare core | removed 판정 | P0 |
| L1-004 | compare core | changed + before/after | P0 |
| L1-005 | compare core | 순서 및 null 안전성 | P1 |
| L1-006 | regression | JS/Python 전체 테스트 | P0 |

### L2: API Tests

| ID | Endpoint | Method | Description | Priority |
|----|----------|--------|-------------|----------|
| L2-001 | `/api/backups` | GET | 목록 반환 | P0 |
| L2-002 | `/api/db` | GET | JSON과 ETag 반환 | P0 |
| L2-003 | `/api/backup?name=missing` | GET | 404 반환 | P1 |

### L3: E2E Tests

| ID | Scenario | Expected Result | Priority |
|----|----------|-----------------|----------|
| L3-001 | 운영 백업 선택 | 사출 +6/~89/-0 요약 | P0 |
| L3-002 | 변경 필터 적용 | 변경 행 95개, 동일 행 0개 표시 | P0 |

### L4: UX Flow Tests

| ID | User Journey | Expected Result | Priority |
|----|--------------|-----------------|----------|
| L4-001 | History 진입 -> 백업 선택 | 상태 배지와 요약이 즉시 표시 | P0 |
| L4-002 | 변경만 보기 | 동일 행 제거, 상세 유지 | P0 |

### L5: Data Flow Tests

| ID | Direction | Validation | Priority |
|----|-----------|------------|----------|
| L5-001 | API -> row builders -> diff -> UI | 집계와 행 상태 일치 | P0 |
| L5-002 | UI -> storage | 쓰기 요청 없음 | P0 |

## 3. Test Data Requirements

기존 운영 백업 `2026-06-10_183424_manual.json`과 현재 데이터를 읽기 전용으로 비교한다. 파일과 운영 DB는 수정하지 않는다.

## 4. Dependencies

- Node.js test runner
- Python unittest
- Playwright MCP
- 로컬 Python 서버 8766

## 5. Coverage Target

| Level | Target | Result |
|-------|--------|:------:|
| L1 | 핵심 분기 100% | Pass |
| L2 | 사용 API 100% | Pass |
| L3 | 핵심 시나리오 100% | Pass |
| L4 | 핵심 사용자 흐름 | Pass |
| L5 | 전체 읽기 데이터 흐름 | Pass |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-06-15 | Final executed test plan |
