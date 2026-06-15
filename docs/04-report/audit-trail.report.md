# Audit Trail — Completion Report

> **Feature**: audit-trail (생산계획 변경 감사 로그) · **R4 #1**
> **Project**: ink-plan · **Date**: 2026-06-15 · **Author**: Hermes Planner (Claude)
> **PDCA**: Plan ✅ → Design ✅ → Do ✅ → Check ✅(100%) → Report ✅

---

## 1. 개요

자동 저장 환경이라 "누가·언제·무엇을 바꿨는지"가 남지 않던 약점을, **저장(commit) 시점에 변경분을 append-only 감사 로그로 누적**하여 해소했다. concurrent-edit-guard(OCC)가 저장 락 안에서 이미 보유한 *before(현재본)*와 *after(요청 본문)*를 그대로 재활용해, 추가 I/O·경합 없이 사출계획·제품·잉크 배정의 변경 항목만 추출한다. `변경 이력` 타임라인 페이지에서 시간순으로 조회한다.

## 2. 구현 요약

| 영역 | 파일 | 변경 |
|------|------|------|
| 변경 추출/누적 | `scripts/storage.py` | `diff_audit`·`_audit_flatten`·`read_audit`·`append_audit`, `write_current_checked(source=)` |
| API | `scripts/server.py` | `GET /api/audit`(최신순·상한), `POST /api/db` `X-Edit-Source` 연동 |
| 표시 헬퍼(순수) | `data-service.js` | `parseAuditField`·`auditChangeKind`·`summarizeAuditEntries` |
| UI | `pages/audit.jsx`(신규) | 타임라인(요약·도메인 필터·검색·이전→현재·출처) |
| 라우팅/출처 | `app.jsx` | NAV `변경 이력`, 라우팅, `X-Edit-Source` 3저장경로(autosave·병합·강제덮어쓰기) |
| 로더/스타일 | `index.html`·`styles.css` | 스크립트 등록(+버전 버스트), 타임라인 스타일 |

### 데이터 포맷 (`data/db/audit.json`, append-only JSON 배열)
```json
{ "ts":"2026-06-15T10:36:39", "field":"injection·3층·10호기·월·day",
  "before":null, "after":"PIA블루", "source":"injection" }
```
- `field` 규약: `injection·{floor}·{machine}·{day}·{shift}` / `products·{name}` / `machineAssignments·{ink}`
- 값 요약: products=`brand|inks`, assignments=`machine|code`

## 3. 핵심 설계 결정

| 결정 | 선택 | 이유 |
|------|------|------|
| diff 위치 | 서버 저장 락(`write_current_checked`) | OCC가 before/after를 이미 보유 — 재조회·경합 없음 |
| 기록 실패 처리 | best-effort try/except | 감사 부가기능이 본 저장을 막지 않음(FR-08) |
| 추적 범위 | injection·products·machineAssignments | 생산계획 핵심, 그 외 필드 변경은 잡음 제외 |
| 출처 | 편집 화면(view)=`X-Edit-Source` | 단일 사내 운영에서 실질 추적 단서 |
| 저장 포맷 | audit.json(JSON 배열) | 스펙 경로 준수·프론트 단순, 규모상 atomic rewrite 충분 |

## 4. 검증 결과

- **JS 174 / Python 67 전부 통과** (audit 신규: JS 5 · storage 9 · server 5)
- **HTTP 종단간**(격리 데이터): 변경 저장 → 2건 최신순 기록(필드·before→after·source·ts 정확), 무변경 저장 → 0건 추가
- **보안**: `audit.json` 정적 차단(404), `/api/audit`만 노출, 동일출처 가드 적용
- **회귀 0**: 기존 OCC/저장/history 동작 무변경(`source=None` 기본 비기록)

## 5. 제약·후속

- **브라우저 시각 QA 미수행**: Playwright 프로필이 다른 세션에 잠겨 실행 불가 → 순수 로직 단위테스트 + 백엔드 HTTP E2E + Babel transpile로 대체. UI는 `history.jsx`와 동일 컴포넌트(Card/Seg/Icon) 패턴.
- **구버전 서버 재시작 필요**: 포트 8766을 구코드 서버가 점유 중 — 새 코드(`/api/audit`, `변경 이력`) 반영하려면 **앱 서버 재시작** 필요(backend-hardening의 기존 주의사항과 동일).
- **향후(범위 외)**: audit.json 로테이션/보존정책, inventory 등 추가 도메인 추적, 변경 되돌리기(undo)는 의도적으로 제외(읽기 안전).

## 6. 학습 포인트

- OCC의 before/after는 감사 로그의 천연 소스 — 쓰기 가드와 변경 추적은 한 락에서 합쳐질 때 가장 정확하고 저렴하다.
- 감사 같은 부가 기록은 반드시 best-effort로 격리해, 보조 기능 실패가 1차 데이터 저장을 위협하지 않게 한다.
- 읽기 측 diff(history-snapshot-diff)와 쓰기 측 diff(audit-trail)는 상호 보완 — 전자는 "두 시점 비교", 후자는 "변경 순간 누적".

---

**결론**: R4 첫 기능 audit-trail은 Plan→Report 전 단계 완료, Match Rate 100%, 전체 테스트 통과. 운영 반영 시 서버 재시작만 필요.
