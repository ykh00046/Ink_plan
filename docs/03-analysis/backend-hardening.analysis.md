# Analysis — 백엔드 견고화 (backend-hardening)

> PDCA Phase: **Check** · 분석일 2026-06-10 · Design: `backend-hardening.design.md`

## Match Rate: 100%

gap-detector 정적 대조 결과, 설계 4개 항목 + 테스트 매트릭스 5개 그룹(33케이스)이
구현에 일대일 반영됨. 누락·불일치 0건.

## 항목별 결과

| 항목 | 구현 | 테스트 | 결과 |
|------|------|--------|:----:|
| ① do_POST 예외 매핑 (400/404/500, str(e) 미노출, traceback 로그) | server.py | PostErrorMapping 7 | ✅ |
| ④ read_body_json (chunked 거부·CL 검증) + 빈 Host 거부 | server.py | ReadBodyJson 5 + ApiGuard | ✅ |
| ③ 정적 deny-by-default + clean.json allowlist | server.py | BlockedStatic 11 | ✅ |
| ② settings 단일 락·단일 write | settings_store.py | settings 5 | ✅ |
| ⑤ 백업 로테이션 mtime 정렬 (scope-in) | storage.py | storage mtime 1 | ✅ |

## 의도적 동작 변경 (설계 명시 1건)
- 빈/누락 Host 거부: 구현(`if host not in ALLOWED_HOSTS`)·테스트(`test_empty_host_blocked`) 양쪽 반영.

## 테스트 실행 결과
- JS: 140 pass (회귀 0)
- Python: 41 pass (settings_store 5 + server 보강 + storage mtime 포함)

## 실서버 통합 QA (비파괴 경로)
`qa_backend_hardening.py` — 서버 스레드 기동 후 10개 검증 **전부 PASS**:
clean.json 200 / sheets·db·settings 404 / GET api/db 200 / 깨진JSON·비-dict·비정수CL 400 / 외부Host·Host누락 403.

## 결론
Match 100% + 회귀 0 + 통합 QA 10/10 → iterate 불필요. `/pdca report` 진행.
