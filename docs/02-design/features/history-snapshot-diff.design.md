# History Snapshot Diff Design Document

> **Summary**: 기존 History 화면에 현재 대비 스냅샷 차이 분석을 추가한다.
>
> **Project**: ink-plan
> **Version**: 1.0.0
> **Author**: Codex
> **Date**: 2026-06-15
> **Status**: Approved
> **Planning Doc**: [history-snapshot-diff.plan.md](../../01-plan/features/history-snapshot-diff.plan.md)

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 백업 스냅샷의 실질적 활용도를 높이고 수동 대조 오류를 줄인다. |
| **WHO** | 잉크 및 사출 생산계획을 관리하고 과거 상태를 확인하는 운영자 |
| **RISK** | 행 식별 키가 불안정하면 변경 유형을 잘못 판정할 수 있다. |
| **SUCCESS** | 3개 기록 탭에서 추가, 변경, 삭제를 정확히 집계하고 전체 테스트가 통과한다. |
| **SCOPE** | 순수 비교 코어, History UI, 스타일, 단위 및 브라우저 QA |

---

## 1. Overview

### 1.1 Design Goals

- 기존 백업 API와 행 빌더를 재사용한다.
- 비교 알고리즘을 UI에서 분리해 결정론적으로 테스트한다.
- 현재 선택 시 기존 화면을 유지하고 백업 선택 시에만 비교 UI를 활성화한다.

### 1.2 Design Principles

- Additive change
- Stable composite keys
- Read-only by construction

---

## 2. Architecture Options

### 2.0 Architecture Comparison

| Criteria | Option A: UI Inline | Option B: 비교 모듈 분리 | Option C: DataService 순수 함수 |
|----------|:-:|:-:|:-:|
| New Files | 0 | 1 | 0 |
| Modified Files | 2 | 3 | 4 |
| Complexity | Low | High | Medium |
| Maintainability | Low | High | High |
| Testability | Low | High | High |
| Existing Pattern Fit | Medium | Low | High |

**Selected**: Option C. 기존 프로젝트가 공유 순수 로직을 `data-service.js`에 모으고 Node 테스트하는 패턴이므로 가장 일관적이다.

### 2.1 Component Diagram

```text
GET /api/backup -> migrateData -> row builders
                                  |
Current data -> row builders ----> DataService.compareHistoryRows
                                  |
                                  v
                     summary + filtered HistoryTable
```

### 2.2 Data Flow

1. 백업 선택
2. 선택 스냅샷과 현재 데이터에서 동일 탭의 행 생성
3. 탭별 복합 키와 비교 필드로 `compareHistoryRows` 호출
4. 상태별 집계 및 표시 행 생성
5. 검색과 변경 필터 적용

---

## 3. Data Model

```js
{
  rows: [{
    ...displayRow,
    _change: 'added' | 'changed' | 'removed' | 'unchanged',
    _before: object | null,
    _after: object | null,
    _changeDetail: string
  }],
  summary: { added, changed, removed, unchanged, totalChanges }
}
```

탭별 키:

| Tab | Key Fields | Value Fields |
|-----|------------|--------------|
| Injection | `floor,machine,day,shift` | `value` |
| Ink plan | `name,day` | `values` |
| Inventory | `date,ink,lotNo` | `value` |

---

## 4. API Specification

신규 API 없음. 기존 `GET /api/backups`, `GET /api/backup?name=`을 그대로 사용한다.

---

## 5. UI/UX Design

### 5.1 Screen Layout

```text
[백업 목록] [기존 스냅샷 요약 카드]
            [현재 대비 +N / ~N / -N] [변경만 보기]
            [탭][검색] [상태 열 | 기존 데이터 열... | 이전 -> 현재]
```

### 5.2 User Flow

기록 조회 -> 백업 선택 -> 변화 요약 확인 -> 탭 선택 -> 변경만 보기 -> 이전/현재 값 확인

### 5.3 Component List

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `HistoryPage` | `pages/history.jsx` | 비교 상태 계산과 필터 |
| `HistoryTable` | `pages/history.jsx` | 상태 배지 및 변경 상세 렌더링 |
| `compareHistoryRows` | `data-service.js` | 행 매칭, 분류, 집계 |

### 5.4 Page UI Checklist

- [x] 백업 선택 시 “현재 대비” 변화 요약
- [x] 추가, 변경, 삭제 건수
- [x] 변경 항목만 보기 체크박스
- [x] 테이블 상태 열과 상태별 행 강조
- [x] 변경 행 이전 값 -> 현재 값
- [x] 기존 검색, 탭, 로딩 건수 표시
- [x] 현재 데이터 선택 시 비교 UI 비활성 안내

---

## 6. Error Handling

- 백업 로드 실패는 기존 notify를 유지한다.
- 잘못된 행 또는 null 입력은 빈 배열로 취급한다.
- 키 필드 누락도 문자열 빈 값으로 정규화해 예외 없이 처리한다.

---

## 7. Security Considerations

- 읽기 전용 기능이며 사용자 입력은 검색 문자열뿐이다.
- HTML 문자열 삽입 없이 React 텍스트 렌더링을 사용한다.
- 파일명은 기존 `encodeURIComponent` 경로를 유지한다.

---

## 8. Test Plan

### 8.1 L1 Unit

| # | Test | Expected |
|---|------|----------|
| 1 | 동일 행 | unchanged |
| 2 | 현재에만 존재 | added |
| 3 | 백업에만 존재 | removed |
| 4 | 동일 키 값 변경 | changed + before/after |
| 5 | 입력 순서 변화 | 결과 판정 동일 |
| 6 | null 입력 | 빈 결과 |

### 8.2 L2 UI Action

| # | Action | Expected |
|---|--------|----------|
| 1 | History 진입 | 기존 현재 데이터 표 렌더링 |
| 2 | 백업 선택 | 현재 대비 요약과 상태 열 표시 |
| 3 | 변경만 보기 | unchanged 행 제외 |
| 4 | 탭 전환 | 탭별 키와 집계 갱신 |

### 8.3 L3 Scenario

백업 선택 -> 변경 행 필터 -> 검색 -> 다른 탭 전환 과정에서 콘솔 오류 없이 일관된 건수를 표시한다.

---

## 9. Architecture

Presentation은 비교 결과만 렌더링하고, 분류 규칙은 DataService에 둔다. 백엔드와 저장 계층의 의존성은 추가하지 않는다.

---

## 10. Coding Convention Reference

- 함수명 camelCase
- 상수는 함수 내부의 명시적 설정 객체로 유지
- 상태 전용 필드는 `_change` 접두어로 화면 데이터와 구분
- 신규 외부 의존성 없음

---

## 11. Implementation Guide

### 11.1 File Structure

```text
data-service.js
pages/history.jsx
styles.css
tests/data-service.test.js
index.html
app.jsx
```

### 11.2 Implementation Order

1. [x] `compareHistoryRows`와 단위 테스트
2. [x] History 비교 상태와 필터
3. [x] 상태 배지 및 스타일
4. [x] 캐시 버전 갱신
5. [x] 전체 테스트와 브라우저 QA

### 11.3 Session Guide

| Module | Scope Key | Description |
|--------|-----------|-------------|
| Compare core | `module-1` | 순수 비교 함수와 단위 테스트 |
| History UI | `module-2` | 비교 요약, 필터, 테이블 |
| QA/Docs | `module-3` | 회귀 테스트, 분석, 보고서 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-06-15 | Approved pragmatic design | Codex |
