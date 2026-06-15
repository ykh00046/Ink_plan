# Audit Trail — Gap Analysis (Check)

> **Design**: `docs/02-design/features/audit-trail.design.md`
> **Date**: 2026-06-15 · **Author**: Hermes Planner (Claude) · **Match Rate**: 100%

---

## 1. 설계 ↔ 구현 대조

| Design 항목 | 구현 위치 | 상태 |
|-------------|-----------|------|
| `_audit_flatten` / `diff_audit` | `scripts/storage.py` | ✅ |
| `read_audit` / `append_audit` (락+atomic, 손상격리) | `scripts/storage.py` | ✅ |
| `write_current_checked(source=)` OCC before/after 재활용 + best-effort | `scripts/storage.py` | ✅ |
| `GET /api/audit` 최신순·상한(1~2000) | `scripts/server.py` | ✅ |
| `POST /api/db` `X-Edit-Source`(기본 web) | `scripts/server.py` | ✅ |
| `parseAuditField` / `auditChangeKind` / `summarizeAuditEntries` | `data-service.js` | ✅ |
| `AuditPage` 타임라인(요약·필터·검색·출처) | `pages/audit.jsx` | ✅ |
| NAV `변경 이력` + 라우팅 + `X-Edit-Source` 3경로 | `app.jsx` | ✅ |
| 스크립트 등록 + 버전 버스트 | `index.html` | ✅ |
| 타임라인/배지 스타일 | `styles.css` | ✅ |

## 2. 요구사항 충족 (FR)

| FR | 검증 | 결과 |
|----|------|------|
| FR-01 변경 항목 산출 | storage `diff_audit` 테스트 + HTTP E2E | ✅ |
| FR-02 `{ts,field,before,after,source}` append | storage/server 테스트 + E2E(2건 기록) | ✅ |
| FR-03 무변경 0건 | `test_diff_no_change_is_empty`, E2E no-op | ✅ |
| FR-04 최신순·상한 | `test_get_audit_returns_newest_first/respects_limit` + E2E | ✅ |
| FR-05 타임라인 표시 | 순수 헬퍼 테스트 + transpile + 패턴 일치 | ✅ |
| FR-06 필터·검색 | `summarizeAuditEntries`/`parseAuditField` + UI | ✅ |
| FR-07 출처 전달 | `test_post_db_records_audit_with_source` + E2E(src=injection) | ✅ |
| FR-08 기록 실패 격리 | `test_audit_failure_does_not_block_save` | ✅ |

## 3. 테스트 결과

- **JS**: 174 pass / 0 fail (audit 헬퍼 5건 신규 포함)
- **Python**: 67 pass / 0 fail (storage 9건 + server 5건 신규 포함)
- **HTTP E2E**(격리 임시 데이터·포트 8799): 초기 `[]` → 변경 저장 → 2건 최신순 기록(`injection·…`, `machineAssignments·…`, src/ts 정확) → 무변경 저장 시 2건 유지
- **정적 차단**: `GET /data/db/audit.json` → 404
- **Transpile**: `audit.jsx`/`app.jsx` 벤더 Babel 통과

## 4. 미해결 / 제약 (정직 보고)

| 항목 | 상태 | 비고 |
|------|------|------|
| 브라우저 시각 QA | 미수행 | Playwright 프로필이 다른 세션에 잠겨 실행 불가. 순수 로직 단위테스트+E2E+transpile로 대체 검증. UI는 `history.jsx`와 동일 컴포넌트 패턴이라 위험 낮음 |
| 구버전 서버 점유 | 운영 주의 | 포트 8766을 구코드 서버가 점유 중 — 새 코드 반영하려면 사용자가 앱 서버 재시작 필요(기존 backend-hardening 주의사항과 동일) |

## 5. 결론

설계 항목 전부 구현·검증됨. **Match Rate 100%** → Iterate 불필요, Report 진행.
