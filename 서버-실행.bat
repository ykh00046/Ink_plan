@echo off
chcp 949 >nul
setlocal
cd /d "%~dp0"

echo ============================================================
echo   잉크/사출 생산계획 - LAN 서버
echo ============================================================
echo.

where git >nul 2>nul
if errorlevel 1 goto NOGIT
echo [업데이트] 최신 코드 받는 중 (git pull --ff-only) ...
git pull --ff-only origin main
goto RUN
:NOGIT
echo [업데이트] git 이 없어 코드 업데이트를 건너뜁니다.

:RUN
echo.
set INK_PLAN_BIND=0.0.0.0

:LOOP
echo [시작] 서버 실행 중...  (종료: 이 창에서 Ctrl+C 후 Y)
python scripts\server.py
echo.
echo [경고] 서버가 종료되었습니다. 5초 후 자동 재시작합니다.
timeout /t 5 /nobreak >nul
goto LOOP
