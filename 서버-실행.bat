@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================================
echo   잉크/사출 생산계획 - LAN 서버
echo ============================================================
echo.

REM --- 1) 코드 업데이트 (git). data/db/ 는 gitignore 라 DB 는 절대 안 건드림 ---
where git >nul 2>nul
if %errorlevel%==0 (
  echo [업데이트] 최신 코드 받는 중 ^(git pull --ff-only^) ...
  git pull --ff-only origin main
  if errorlevel 1 (
    echo [주의] 업데이트 실패/충돌 - 기존 코드로 계속 실행합니다.
  )
) else (
  echo [업데이트] git 이 없어 코드 업데이트를 건너뜁니다.
)
echo.

REM --- 2) LAN 모드로 서버 실행 (다른 PC 접속 허용) ---
set INK_PLAN_BIND=0.0.0.0

:loop
echo [시작] 서버 실행 중... (완전 종료: 이 창에서 Ctrl+C, 그다음 Y)
python scripts\server.py
echo.
echo [경고] 서버가 종료되었습니다. 5초 후 자동 재시작합니다.
timeout /t 5 /nobreak >nul
goto loop
