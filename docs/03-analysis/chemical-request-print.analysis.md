# Gap Analysis — 약품요청서 인쇄물 완성 (chemical-request-print)

> PDCA Check · 2026-06-08 · [[chemical-request-print]] Design 대비 구현 대조

## 1. 대조 결과 (Design 명세 → 구현)

| # | Design 항목 | 구현 | 검증 | 상태 |
|---|---|---|---|---|
| 1 | `buildChemicalRequestMeta(totals, rangeLabel, requester, todayISO)` 순수 코어 | `data-service.js` 신설 | 단위 5케이스 GREEN + 런타임 eval | ✅ |
| 2 | 작성자 fallback (`trim() || '생산관리팀'`) | `requester != null && String().trim() \|\| '생산관리팀'` | 빈/공백/undefined/null 4종 → fallback | ✅ |
| 3 | 문서번호 `약품-YYYYMMDD` (todayISO 주입) | `split('-').join('')` 기반 | `약품-20260608` / 누락 시 `약품-미상` | ✅ |
| 4 | 1줄 요약 + noCode 전달 | `summary` + `noCode` | `총 잉크 3종 / 총 세트 42 (3F 30 · 1F 12)` | ✅ |
| 5 | 결재 roster `['작성','검토','승인']` | 반환 | deepEqual GREEN | ✅ |
| 6 | export 노출 | 반환 객체 + `module.exports` | `DataService.buildChemicalRequestMeta` 노출 확인 | ✅ |
| 7 | `chemicals.jsx` ctx.tweaks 수신 + meta useMemo | 적용 (`[totals,rangeLabel,tweaks,todayISO]`) | — | ✅ |
| 8 | 인쇄 헤더 하드코딩 제거 + meta 사용 | `김선명` 제거, 문서번호·작성자·요약 동적 | DOM `hardcodedAuthorGone=true` | ✅ |
| 9 | 결재란 JSX(작성/검토/승인 3칸) | `.chem-approval` 추가 | DOM roles=[작성,검토,승인] | ✅ |
| 10 | `TWEAK_DEFAULTS.requester=''` | 추가 | 초기 헤더 fallback 표시 | ✅ |
| 11 | `TweaksControls` 작성자 입력 (`TweakText`) | "약품요청서" 섹션 추가 | edit-mode 패널서 입력 → 헤더 반영 | ✅ |
| 12 | `styles.css` 결재란 (평소 숨김 + @media print) | `.chem-approval` 화면 none / print flex | print 에뮬: header=block, approval=flex | ✅ |
| 13 | 캐시 버전 bump(4파일 통일) | v=59 통일 (styles/data-service/chemicals/app) | — | ✅ |

## 2. 성공 기준 충족 (Plan §6)

| 기준 | 결과 |
|---|---|
| 작성자 설정 변경 → 인쇄 헤더 반영 (하드코딩 제거) | ✅ `이몽룡 (구매2팀)` 입력 → 헤더 즉시 반영 / `김선명` 소스 제거 |
| 미설정/공백 → `생산관리팀` fallback | ✅ 초기 상태 헤더 `작성자: 생산관리팀` |
| 인쇄: 결재란 3칸 + 문서번호 `약품-YYYYMMDD` | ✅ print 에뮬 + 스크린샷 증빙 |
| 화면: 결재란 미표시, 레이아웃 회귀 0 | ✅ 화면 `display:none`, 헤더도 평소 숨김 |
| 단위 테스트 GREEN + 회귀 0 | ✅ 96 pass / 0 fail (기존 91 + 신규 5) |
| Match Rate ≥ 90% | ✅ **100%** |

## 3. Match Rate

**13/13 = 100%**

미스매치·미구현 항목 없음.

## 4. 회귀 점검

- 기존 테스트 91 → 96 전부 GREEN (회귀 0)
- 화면 레이아웃: 결재란·인쇄헤더 모두 평소 `display:none` → 비인쇄 화면 변화 0
- `TWEAK_DEFAULTS` 키 추가는 비파괴(useTweaks 머지) — 기존 tweaks 동작 유지
- JSX 컴파일 0 errors, 앱 정상 로드(콘솔 error 0)

## 5. QA 환경 이슈

| 이슈 | 조치 |
|---|---|
| 포트 8765 타 앱(Flow Notification Collector) 선점 | 임시 런처 `_qa_launcher.py`로 8799 + ALLOWED_HOSTS monkeypatch QA 후 삭제 (소스 무수정) |
| Tweaks 패널 지연 렌더(edit-mode 전용) | `__activate_edit_mode` 메시지로 패널 오픈 후 실제 입력 검증 |

→ Match Rate 100% ≥ 90% → Report 단계로 진행 (iterate 불필요)
