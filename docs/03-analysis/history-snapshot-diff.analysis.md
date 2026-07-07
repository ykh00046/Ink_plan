# History Snapshot Diff Analysis Report

> **Analysis Type**: Design Gap / Runtime Verification
>
> **Project**: ink-plan
> **Version**: 1.0.0
> **Analyst**: Codex
> **Date**: 2026-06-15
> **Design Doc**: [history-snapshot-diff.design.md](../02-design/features/history-snapshot-diff.design.md)

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 백업 스냅샷의 활용도를 높이고 수동 대조 오류를 줄인다. |
| **WHO** | 생산계획과 과거 상태를 확인하는 운영자 |
| **RISK** | 행 식별 키가 불안정하면 변경 유형을 잘못 판정할 수 있다. |
| **SUCCESS** | 세 탭에서 변화 유형을 판정하고 전체 테스트와 브라우저 QA를 통과한다. |
| **SCOPE** | 비교 코어, History UI, 스타일, 단위 및 브라우저 QA |

---

## Strategic Alignment Check

| Element | Expected | Status |
|---------|----------|:------:|
| Core problem | 과거와 현재를 수동으로 대조해야 함 | Met |
| Target user | 기록을 확인하는 운영자 | Met |
| Value | 백업을 변경 이력으로 활용 | Delivered |

### Success Criteria Status

| # | Criteria | Status | Evidence |
|---|----------|:------:|----------|
| SC-1 | 세 탭 복합 키와 변화 판정 | Met | `pages/history.jsx:3`, `data-service.js:1497` |
| SC-2 | 요약과 변경 필터 일치 | Met | 운영 백업: +6/~89/-0, 필터 후 95행·동일 0행 |
| SC-3 | 이전 값과 현재 값 표시 | Met | Playwright detail `BACKUP -> current` |
| SC-4 | 현재 조회와 검색 회귀 없음 | Met | JS 전체 176 pass |
| SC-5 | 전체 테스트와 브라우저 QA | Met | JS 176 + Python 67, console error 0 |

**Success Rate**: 5/5 (100%)

---

## 1. Gap Analysis

### 1.1 Structural Match

| Design Item | Implementation | Status |
|-------------|----------------|:------:|
| `compareHistoryRows` | `data-service.js:1497` | Match |
| 탭별 키 설정 | `pages/history.jsx:3` | Match |
| 변화 요약 | `pages/history.jsx:164` | Match |
| 변경 필터 | `pages/history.jsx:192` | Match |
| 상태 테이블 | `pages/history.jsx:235` | Match |
| 스타일 | `styles.css:591` | Match |
| 단위 테스트 | `tests/data-service.test.js:796` | Match |

**Structural Match Rate**: 100%

### 1.2 Functional Depth

- 추가, 변경, 삭제, 동일 네 상태를 실제 데이터 구조로 판정한다.
- 변경 행은 `_before`, `_after`, `_changeDetail`을 보존한다.
- 검색과 변경 필터를 동시에 적용한다.
- 현재 데이터 선택 시 비교 UI를 비활성화한다.
- 필터 결과가 0건이면 전용 빈 상태 문구를 표시한다.

**Functional Match Rate**: 100%

### 1.3 Contract Verification

신규 API는 없다. 기존 백업 계약을 그대로 사용했다.

| Endpoint | Expected | Runtime | Status |
|----------|----------|---------|:------:|
| `GET /api/backups` | 백업 목록 | 36건 반환 | Pass |
| `GET /api/db` | 현재 JSON + ETag | 200, ETag 존재 | Pass |
| `GET /api/backup?name=missing` | 미존재 오류 | 404 | Pass |

**Contract Match Rate**: 100%

### 1.4 Runtime Verification

| Level | Result |
|-------|--------|
| L1 | JS 176/176, Python 67/67 |
| L2 | 백업 목록, DB, 404 API 검증 |
| L3 | 운영 백업 선택 후 사출 +6/~89/-0 집계 |
| L4 | 변경만 보기 후 95행, unchanged 0행; 탭 전환 정상 |
| L5 | 기존 백업/현재 데이터 읽기 전용 흐름, 운영 데이터 쓰기 0 |

스크린샷: [history-snapshot-diff-preview.png](./history-snapshot-diff-preview.png)

**Runtime Match Rate**: 100%

> **Final integration note**: 별도 `audit-trail` 동시 작업까지 합쳐진 최종 작업트리에서 JS 176/176, Python 67/67이 모두 통과했다.

### 1.5 Match Rate Summary

| Axis | Rate |
|------|:----:|
| Structural | 100% |
| Functional | 100% |
| Contract | 100% |
| Runtime | 100% |
| **Overall** | **100%** |

---

## 2. Iterate Record

Check 단계에서 발견한 비차단 개선 2건을 반영했다.

1. 비교 코어의 책임을 나타내는 주석을 명확히 분리했다.
2. 변경 필터 결과 0건의 빈 상태를 “저장 데이터 없음”과 구분했다.

Iterate 후 최종 통합 테스트를 재실행해 243/243 통과했다.

---

## 3. Risks

- 탭별 복합 키는 현재 데이터 모델에서 고유하다는 전제다.
- 향후 동일 키의 중복 행을 허용하면 안정 ID 기반 비교로 확장해야 한다.
- bkit 사전 스캐너는 Windows Git Bash 경로를 Node `require`에 전달하는 플러그인 호환성 문제로 실행되지 않았다.

---

## 4. Decision

Critical 0, Important 0. Match Rate 100%로 QA 및 Report 진행.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-06-15 | Final analysis after iterate | Codex |
