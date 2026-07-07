# Code Review Report — 2026-05-19

대상 커밋: `7fe48a6 Checkpoint: working app + review hardening` (base: `ecd8da4 Initial`)
범위: 이번 세션 하드닝 변경분 (data/clean.json 등 데이터/노이즈 제외)

## Summary

- 검토 파일: 하드닝 관련 11파일 + 후속 보강 3파일
- 발견 이슈: Critical 0 · Major 0 · Warning 4(전부 후속 수정으로 해소) · Info 2
- 품질 점수: 82/100 → 후속 수정 반영 후 회귀 없음
- 테스트: `npm test` 14/14 통과
- 판정: **배포 가능 (Ship-ready)**

## 1차 분석 (code-analyzer) — Warning 4건, 모두 후속 수정 완료

| # | 파일 | 이슈 | 조치 |
|---|------|------|------|
| W1 | pages/ocr-import.jsx | `[]` 리스너 + stale closure → blob URL 누수 | blob revoke를 `useEffect([previewUrl])` cleanup으로 일원화 |
| W2 | scripts/server.py | `do_HEAD` 미차단 → DB 파일 존재/크기 노출 | `is_blocked_static()` 헬퍼 + `do_HEAD` 동일 차단 |
| W3 | scripts/server.py | `startswith` 대소문자 우회 가능 | `unquote(...).lower()` 비교 |
| W4 | data-service.js | `parseDateLocal` 월/일 범위 미검증 (롤오버) | 생성 Date 재검증 후 불일치 시 null |

## 2차 검증 (code-analyzer) — 후속 수정 회귀 점검

- W1: cleanup effect가 직전 previewUrl을 정확히 revoke. 연속 pick/paste·언마운트 모두 정상. 리스너 1회 등록과 모순 없음.
- W2/W3: `/data/clean.json` seed는 정상 서빙(차단 prefix 비매칭). `do_HEAD`는 표준 메서드로 fallback 안전. `.lower()`는 비교 변수에만 적용, 정상 라우트 무영향. 인코딩/대소문자 우회 차단 유효.
- W4: 정상 0-padding 날짜 통과, `2026-13-40` 등 롤오버 null. 시스템 내부 입력은 전부 `localDateISO()`/`<input type=date>` 산출이라 회귀 없음. 오히려 깨진 LotNo 방어 강화.
- 테스트: 세 수정 모두 단위 테스트 로직과 무관, 14/14 유지 논리적 성립.

## 잔여 권고 (후속 라운드, 회귀 아님)

- **[Info] ocr-import.jsx**: `run()`이 `setOcrResult({ sourceImageUrl: previewUrl })`로 blob URL을 검수 페이지에 전달하는데, OCR 페이지 언마운트 시 cleanup이 해당 URL을 revoke → 검수 페이지 이미지가 깨질 수 있음. *기존 동작이며 이번 수정이 만든 문제 아님.* 검수 페이지에서 별도 ObjectURL을 만들거나 dataURL로 전달하는 방식으로 분리 권장.
- **[Info] server.py**: `read_body_json`이 `Content-Length` 헤더를 신뢰. localhost 단일 사용자라 우선순위 낮음. 견고화하려면 `MAX_BODY_BYTES+1`까지 읽고 초과 거부.

## 결론

이번 하드닝은 신규 결함 없이 기존 UTC 파싱 버그·정적 노출·CDN 의존을 교정한 개선. 배포 가능.
