# 잉크/사출 생산계획 시스템 (ink_plan)

> 잉크 및 사출(Injection) 생산계획 관리를 위한 React SPA + Python 백엔드 웹 애플리케이션

## Project Level
**Level: Dynamic** (React 프론트엔드 + Python HTTP 서버 + JSON 파일 스토리지)

## Quick Start

```bash
# 서버 실행 (Python)
cd scripts
python server.py
# http://127.0.0.1:8766  (8765는 C:\X\Flow가 사용 — 충돌로 2026-06 변경)

# 또는 VBS를 통한 백그라운드 실행
start.vbs

# 테스트
npm test
# 또는
node --test tests/data-service.test.js tests/ui-regressions.test.js tests/date-utils.test.js
```

## Architecture

```
┌──────────────────┐     ┌───────────────┐     ┌──────────┐
│  React SPA       │────▶│  Python HTTP  │────▶│  JSON     │
│  (Babel in-browser)│    │  server.py    │     │  /data/db │
│  index.html      │◀────│  (8766 port)  │     │  current  │
│  pages/*.jsx     │     │  storage.py   │     │  .json    │
│  data-service.js │     └───────────────┘     └──────────┘
│  ui.jsx          │
│  app.jsx         │
└──────────────────┘
```

### 주요 디렉토리 구조

```
index.html              # SPA 진입점 (Babel 인라인 트랜스파일)
app.jsx                 # 메인 App 컴포넌트 + 사이드바 + 데이터 로드
data-service.js         # 핵심 데이터 로직 (순수 함수, Node.js 테스트 가능)
ui.jsx                  # 공유 UI 컴포넌트
tweaks-panel.jsx        # 설정/튜닝 패널
styles.css              # 전체 스타일

pages/
├── ink-plan.jsx        # 잉크 생산계획
├── injection.jsx       # 사출 계획
├── products.jsx        # 제품 마스터 관리
├── ink-add.jsx         # 잉크 추가
├── chemicals.jsx       # 약품 관리
├── machines.jsx        # 호기(기계) 관리
├── inventory.jsx       # 재고 관리
├── history.jsx         # 이력 조회
├── review.jsx          # 검수
├── test-inks.jsx       # 테스트 잉크
├── ocr-import.jsx      # OCR 가져오기
└── data-quality.jsx    # 데이터 품질

scripts/
├── server.py           # HTTP 서버 (ThreadingHTTPServer, port 8766)
├── storage.py          # DB/백업 파일 I/O
├── settings_store.py   # 설정 저장
├── build_release.py    # 릴리스 빌드
├── backup.py           # 백업 스크립트
└── tray_app.py         # 시스템 트레이 앱

vendor/                 # CDN 대체 로컬 라이브러리
├── react.production.min.js
├── react-dom.production.min.js
├── babel.min.js
└── fonts/

data/
├── clean.json          # 클린 데이터 스냅샷
├── db/                 # JSON 데이터 (current.json, gitignore)
├── backups/            # 자동 백업 (gitignore)
├── settings.json       # 사용자 설정
└── sheets.json         # 시트 메타데이터

tests/
├── data-service.test.js   # data-service 순수 로직 테스트 (Node.js)
├── ui-regressions.test.js # UI 회귀 테스트
└── date-utils.test.js     # 날짜/LOT 유틸리티 테스트
```

## Key Commands

| 작업 | 명령어 |
|------|--------|
| 서버 실행 | `python scripts/server.py` |
| 백그라운드 실행 | `start.vbs` 또는 `backup-now.vbs` |
| 테스트 | `node --test tests/data-service.test.js tests/ui-regressions.test.js tests/date-utils.test.js` |
| 릴리스 빌드 | `python scripts/build_release.py` |
| 제품 가져오기 | `python scripts/import_products.py` |

## Coding Conventions

- **프론트엔드**: React (Babel 인라인 트랜스파일, 번들러 없음)
- **백엔드**: Python 표준 라이브러리만 사용 (ThreadingHTTPServer)
- **JSX**: 브라우저에서 `<script type="text/babel">` 로 직접 로드
- **데이터 로직**: `data-service.js`는 IIFE 패턴, 순수 함수만 사용 (테스트 가능)
- **모듈 패턴**: `DataService`를 글로벌로 노출, 각 페이지는 JSX `<script>` 태그로 로드
- **한글**: UI 텍스트와 주석은 한국어
- **DB**: JSON 파일, `data/db/current.json` 경로 (gitignore)

## Important Notes

- **빌드 도구 없음**: Webpack/Vite 미사용. Babel 브라우저 내 트랜스파일 방식
- **데이터 마이그레이션**: `app.jsx`의 `migrateData()`에서 구버전 → 신버전 제품 구조 변환
- **기계 할당**: `machineAssignments` 배열로 잉크→호기 매핑 (구버전 `inkMachines` 제거됨)
- **백업**: `data/backups/`에 자동 생성, `data/clean.json`은 초기 스냅샷
- **요청 본문 제한**: 서버에서 64MB 상한 (`MAX_BODY_BYTES`)
- **정적 파일 보호**: `/data/db`, `/data/backups`, `/data/settings` 경로는 정적 노출 차단
- **패키지 매니저**: `package.json` 있지만 의존성 없음 (테스트 스크립트만 정의)
