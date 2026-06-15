# History Snapshot Diff Planning Document

> **Summary**: 기록 조회에서 선택 백업과 현재 데이터의 차이를 즉시 식별한다.
>
> **Project**: ink-plan
> **Version**: 1.0.0
> **Author**: Codex
> **Date**: 2026-06-15
> **Status**: Approved

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 기존 기록 조회는 스냅샷 내용을 열람할 수 있지만 현재 대비 추가, 삭제, 변경된 항목을 사용자가 직접 대조해야 한다. |
| **Solution** | 선택 백업을 기준 시점으로 두고 현재 데이터와 행 단위로 비교해 변화 요약, 상태 배지, 변경 항목 필터를 제공한다. |
| **Function/UX Effect** | 복구 전 영향 판단과 변경 추적을 한 화면에서 수행하고, 변경된 행만 좁혀 확인할 수 있다. |
| **Core Value** | 기존 백업 자산을 운영 판단에 직접 쓸 수 있는 변경 이력으로 전환한다. |

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

### 1.1 Purpose

선택한 백업 시점과 현재 데이터 사이의 변화를 사출계획, 잉크 생산계획, 재고 조사 탭별로 가시화한다.

### 1.2 Background

bkit 완료 보고서의 잔여 추천 1순위는 History 뷰 강화다. 현재 `pages/history.jsx`와 백업 API는 이미 존재하므로 신규 저장 모델보다 기존 자산의 비교 가시성을 강화하는 것이 가장 높은 가치와 낮은 위험을 가진다.

### 1.3 Related Documents

- `docs/04-report/unified-dashboard.report.md`
- `docs/04-report/chemical-request-print.report.md`

---

## 2. Scope

### 2.1 In Scope

- [x] 선택 백업과 현재 데이터의 행 단위 비교
- [x] 추가, 변경, 삭제, 동일 상태 분류
- [x] 탭별 변화 요약과 변경 항목만 보기
- [x] 변경 행의 이전 값과 현재 값 표시
- [x] 순수 비교 함수 단위 테스트와 브라우저 QA

### 2.2 Out of Scope

- 백업 복원 또는 부분 복원
- 백업 파일 생성, 보존 정책, API 형식 변경
- 제품 및 마스터 전체 스냅샷 비교

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 선택 백업과 현재 데이터의 행을 안정 키로 매칭한다. | High | Approved |
| FR-02 | 행을 추가, 변경, 삭제, 동일로 분류한다. | High | Approved |
| FR-03 | 현재 탭의 변화 건수를 요약한다. | High | Approved |
| FR-04 | 변경 항목만 보기 필터를 제공한다. | High | Approved |
| FR-05 | 변경 행은 이전 값과 현재 값을 함께 보여준다. | Medium | Approved |
| FR-06 | 현재 데이터 선택 시 기존 읽기 전용 조회 동작을 유지한다. | High | Approved |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Correctness | 동일 키 중복 없이 변화 유형 판정 | Node 단위 테스트 |
| Performance | 화면 내 행 비교를 동기 처리해 체감 지연 없음 | 브라우저 QA |
| Compatibility | 신규 의존성 및 백엔드 변경 없음 | diff 및 전체 테스트 |
| Safety | History 화면은 계속 읽기 전용 | 코드 및 브라우저 검증 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [x] SC-1: 세 탭 모두 안정 키로 추가, 변경, 삭제를 판정한다.
- [x] SC-2: 변화 요약과 변경 항목 필터가 실제 행 상태와 일치한다.
- [x] SC-3: 변경 행에서 이전 값과 현재 값을 확인할 수 있다.
- [x] SC-4: 현재 데이터 조회와 검색 기능에 회귀가 없다.
- [x] SC-5: JS 및 Python 전체 테스트와 브라우저 QA가 통과한다.

### 4.2 Quality Criteria

- [x] 비교 코어 단위 테스트 5개 이상
- [x] 기존 테스트 실패 0
- [x] 콘솔 오류 0

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 행 키 충돌 | High | Low | 탭별 복합 키를 명시하고 단위 테스트한다. |
| 값 직렬화 순서 차이 | Medium | Low | 기존 `stableEqual`을 재사용한다. |
| 대량 행 UI 과밀 | Medium | Medium | 변경 필터와 간결한 배지, 상세 텍스트를 사용한다. |

---

## 6. Impact Analysis

### 6.1 Changed Resources

| Resource | Type | Change Description |
|----------|------|--------------------|
| `DataService` | Shared logic | 행 비교 순수 함수 추가 |
| `HistoryPage` | UI | 현재 대비 비교 상태와 필터 추가 |
| `styles.css` | UI style | 비교 요약, 상태 배지, 행 강조 |

### 6.2 Current Consumers

| Resource | Operation | Code Path | Impact |
|----------|-----------|-----------|--------|
| `DataService` export | READ | Node tests, browser pages | Additive, non-breaking |
| History row builders | READ | `pages/history.jsx` | 비교 키와 표시 값 검증 필요 |
| Backup API | READ | `GET /api/backups`, `/api/backup` | 변경 없음 |

### 6.3 Verification

- [x] 기존 DataService 소비자 전체 테스트
- [x] 백업 API 서버 테스트
- [x] History 페이지 검색과 탭 전환 브라우저 검증

---

## 7. Architecture Considerations

### 7.1 Project Level Selection

Dynamic. React SPA, Python HTTP 서버, JSON 파일 저장소의 현 구조를 유지한다.

### 7.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 비교 위치 | UI inline / DataService | DataService | 순수 함수 테스트와 재사용성 확보 |
| 비교 기준 | 직전 백업 / 현재 데이터 | 현재 데이터 | 운영자가 지금과 과거의 차이를 판단하는 목적 |
| 상태 모델 | boolean / enum | `added/changed/removed/unchanged` | UI와 집계 의미가 명확 |
| 백엔드 | 신규 API / 기존 API | 기존 API | 두 스냅샷이 이미 클라이언트에 존재 |

---

## 8. Convention Prerequisites

- 기존 IIFE `DataService` export 패턴을 따른다.
- JSX는 브라우저 Babel 방식과 전역 React 훅 패턴을 유지한다.
- 외부 패키지를 추가하지 않는다.

---

## 9. Next Steps

1. [x] Design 작성
2. [x] 비교 코어 및 UI 구현
3. [x] Check, Iterate, QA, Report

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-06-15 | Initial approved plan | Codex |
