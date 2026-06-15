# Audit Trail Planning Document

> **Summary**: 저장(commit) 시점에 사출계획·제품·잉크 배정의 변경분을 append-only 감사 로그로 남겨 "누가·언제·무엇을 바꿨나"를 추적한다.
>
> **Project**: ink-plan
> **Version**: 1.0.0
> **Author**: Hermes Planner (Claude)
> **Date**: 2026-06-15
> **Status**: Approved

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 현재 백업 스냅샷(history)으로 과거 상태는 열람할 수 있지만, 두 시점 사이에 *무엇이* 바뀌었는지는 스냅샷 통째 비교로만 추정해야 한다. 자동 저장이라 변경 시점·출처가 기록되지 않는다. |
| **Solution** | 서버 저장 경로(OCC `write_current_checked`)에서 before/after를 이미 확보하므로, 그 지점에서 injection/products/machineAssignments의 변경분만 diff로 떠 `data/db/audit.json`에 append-only로 누적한다. |
| **Function/UX Effect** | `기록 조회` 옆에 `변경 이력` 타임라인 뷰를 추가해 시간순 변경 항목(필드·이전→현재·출처)을 한눈에 본다. |
| **Core Value** | 자동 저장의 약점(무명·무시점 변경)을 메우고, 운영 사고 추적·복구 판단의 1차 근거를 만든다. |

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 자동 저장 환경에서 변경 추적성(audit)을 확보해 오기입·되돌림 사고를 빠르게 규명한다. |
| **WHO** | 잉크·사출 생산계획을 편집/검수하는 운영자, 데이터 정합성을 점검하는 관리자 |
| **RISK** | diff 키가 불안정하면 변경 유형을 오판정한다. 감사 로그 기록 실패가 본 저장을 막아서는 안 된다. |
| **SUCCESS** | 3개 도메인의 변경이 정확히 항목화되고, 타임라인에서 시간·출처·이전→현재가 표시되며, 전체 테스트 통과. |
| **SCOPE** | 서버 diff/append 헬퍼, `/api/audit` 조회 API, 순수 파싱/요약 헬퍼, AuditPage UI, 단위·서버 테스트, 브라우저 QA |

---

## 1. Overview

### 1.1 Purpose

저장이 일어날 때마다 사출계획(injection), 제품 마스터(products), 잉크 배정(machineAssignments)의 **변경된 항목만** `{ts, field, before, after, source}` 형태로 append-only 기록하고, 이를 시간순 타임라인으로 보여준다.

### 1.2 Background

- `concurrent-edit-guard`(완료, OCC)에서 서버는 저장 시 현재 파일을 읽어 base 리비전과 비교한다(`storage.write_current_checked`). 이때 **before(현재 파일)와 after(요청 본문)가 동시에 한 락 안에** 존재한다 — diff 추출의 최적 지점이며 별도 재조회가 필요 없다.
- `history-snapshot-diff`(진행)는 *스냅샷 2개의 행 비교*(읽기 측, 클라이언트)인 반면, audit-trail은 *저장 순간의 변경분 누적*(쓰기 측, 서버)이다. 상호 보완적이며 중복되지 않는다.

### 1.3 Related Documents

- `docs/04-report/concurrent-edit-guard.report.md` (OCC 재활용 근거)
- `docs/04-report/backend-hardening.report.md` (storage/atomic write 패턴)
- `docs/02-design/features/history-snapshot-diff.design.md` (읽기 측 diff와의 경계)

---

## 2. Scope

### 2.1 In Scope

- [x] 서버 저장 시 injection/products/machineAssignments 변경분 diff 추출 (OCC before/after 재활용)
- [x] `data/db/audit.json` append-only 누적 (atomic write)
- [x] `GET /api/audit` 최신순 조회 API (반환 상한)
- [x] `변경 이력` 타임라인 페이지 (필드 종류 필터 + 검색)
- [x] 클라이언트 → 서버 변경 출처(`X-Edit-Source`) 전달
- [x] 순수 헬퍼 단위 테스트(JS) + storage/server 테스트(Python)

### 2.2 Out of Scope

- 변경 되돌리기(undo)/부분 복원 — 본 기능은 기록·조회 전용(읽기 안전)
- inventory/inkPlan/testInks 등 그 외 필드의 변경 추적 (요청 범위 외)
- 사용자 인증·계정 단위 식별 (단일 사내 운영, source는 편집 화면 단위)
- 감사 로그 로테이션/보존정책 (append-only 유지, 조회만 상한)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 저장 시 injection/products/machineAssignments의 변경 항목을 산출한다. | High | Approved |
| FR-02 | 각 변경을 `{ts, field, before, after, source}`로 audit.json에 append한다. | High | Approved |
| FR-03 | 변경이 없으면(diff 빈 결과) 아무 것도 기록하지 않는다(잡음 0). | High | Approved |
| FR-04 | `GET /api/audit`는 최신순으로 변경 이력을 반환(상한 적용)한다. | High | Approved |
| FR-05 | `변경 이력` 페이지가 시간·필드·이전→현재·출처를 타임라인으로 표시한다. | High | Approved |
| FR-06 | 필드 종류(사출/제품/잉크) 필터와 텍스트 검색을 제공한다. | Medium | Approved |
| FR-07 | 클라이언트는 편집 화면을 출처(source)로 전달한다. | Medium | Approved |
| FR-08 | 감사 로그 기록이 실패해도 본 저장(current.json)은 정상 커밋된다. | High | Approved |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Correctness | 동일 키 중복/오판정 없이 added/removed/changed 구분 | Python·Node 단위 테스트 |
| Atomicity | append는 `_LOCK` + atomic temp-replace로 손상 방지 | storage 테스트 |
| Isolation | audit 실패가 저장을 막지 않음 (best-effort) | storage 테스트 |
| Security | audit.json은 `/data/` 정적 차단 유지, `/api/audit`로만 노출 | server 테스트 |
| Compatibility | 신규 의존성 0, 기존 OCC/저장 동작 회귀 0 | 전체 테스트 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] SC-1: 세 도메인 변경이 정확한 field 경로와 before/after로 기록된다.
- [ ] SC-2: 변경 없는 저장은 audit 엔트리를 0건 추가한다.
- [ ] SC-3: `/api/audit`가 최신순·상한으로 동작하고 정적 노출은 차단된다.
- [ ] SC-4: `변경 이력` 타임라인에서 시간·출처·이전→현재를 확인하고 필터/검색이 동작한다.
- [ ] SC-5: 기존 OCC·저장·history 동작에 회귀가 없고 JS·Python 전체 테스트 통과.

### 4.2 Quality Criteria

- [ ] 순수 헬퍼(JS) 단위 테스트 4개 이상
- [ ] storage/server(Python) 테스트 4개 이상
- [ ] 기존 테스트 실패 0, 콘솔 오류 0

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| diff 키 충돌(중복 호기명 등) | Medium | Low | floor·machine·day·shift 복합 키 명시 + 단위 테스트 |
| audit.json 무한 성장 | Low | Medium | 조회 상한(N)으로 UI 보호, 엔트리 경량(문자열 요약) |
| 감사 기록 실패가 저장 차단 | High | Low | try/except로 best-effort, 저장 성공 후 append |
| 대량 OCR 머지 시 다수 엔트리 | Low | Medium | 의도된 동작(셀 단위 추적), 필터로 가독성 확보 |

---

## 6. Impact Analysis

### 6.1 Changed Resources

| Resource | Type | Change Description |
|----------|------|--------------------|
| `scripts/storage.py` | Backend | `diff_audit`, `append_audit`, `read_audit` + `write_current_checked(source=)` |
| `scripts/server.py` | Backend | `/api/audit` GET, POST `/api/db`에 `X-Edit-Source` 연동 |
| `data-service.js` | Shared logic | `parseAuditField`, `auditChangeKind`, `summarizeAuditEntries` 순수 헬퍼 |
| `pages/audit.jsx` | UI (신규) | 변경 이력 타임라인 페이지 |
| `app.jsx` | UI | NAV 항목·라우팅·`X-Edit-Source` 헤더 |
| `index.html` | Loader | audit.jsx 스크립트 등록 |
| `styles.css` | UI style | 타임라인/배지 스타일 |

### 6.2 Current Consumers

| Resource | Operation | Code Path | Impact |
|----------|-----------|-----------|--------|
| `write_current_checked` | WRITE | server `POST /api/db` | source 인자 추가(기본 None=비기록) → 기존 호출 무해 |
| OCC 저장 흐름 | WRITE | `app.jsx` postDb/충돌 해소 | 헤더 1개 추가, 로직 불변 |
| 정적 차단 | READ | `/data/` deny | audit.json 자동 차단(동일 트리) |

### 6.3 Verification

- [ ] storage 단위 테스트(diff/append/실패격리)
- [ ] server 테스트(`/api/audit`, 정적 차단, source 기록)
- [ ] data-service 순수 헬퍼 테스트
- [ ] 브라우저 QA: 편집→저장→타임라인 반영, 필터/검색

---

## 7. Architecture Considerations

### 7.1 Project Level Selection

Dynamic. React SPA + Python HTTP 서버 + JSON 파일 저장소 구조 유지. 신규 의존성 없음.

### 7.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| diff 추출 위치 | 클라이언트 / 서버 저장 경로 | **서버(write_current_checked)** | OCC가 이미 before/after를 한 락에 보유 — 재조회·경합 없음 |
| 저장 포맷 | JSONL / JSON 배열 | **JSON 배열(audit.json)** | 스펙 경로 준수, 프론트 파싱 단순, 규모상 atomic rewrite 충분 |
| 추적 범위 | 전 필드 / 3개 도메인 | **injection·products·machineAssignments** | 생산계획 핵심, 잡음 최소화 (요청 범위) |
| 엔트리 값 | 객체 통째 / 문자열 요약 | **경량 문자열 요약** | 로그 크기·가독성, 타임라인 표시에 충분 |
| 출처(source) | 인증 사용자 / 편집 화면 | **편집 화면(view) 식별자** | 단일 사내 운영, 화면 단위가 실질 추적 단서 |
| 기록 실패 처리 | 트랜잭션 / best-effort | **best-effort(try/except)** | 감사 부가기능이 본 저장을 막지 않도록(FR-08) |

---

## 8. Convention Prerequisites

- `storage.py`는 표준 라이브러리만 사용, `_LOCK` + `write_json_atomic` 패턴 준수.
- `data-service.js`는 IIFE export·순수 함수 유지(Node 테스트 가능).
- JSX는 브라우저 Babel·전역 컴포넌트 등록(`window.AuditPage`) 패턴 유지.
- 외부 패키지 추가 금지.

---

## 9. Next Steps

1. [x] Design 작성
2. [ ] 서버 diff/append + API + UI 구현
3. [ ] Check(Gap) · QA · Report

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-06-15 | Initial approved plan | Hermes Planner (Claude) |
