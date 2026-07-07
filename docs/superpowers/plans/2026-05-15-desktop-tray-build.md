# Desktop Tray Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python-free Windows distribution with a tray icon, hidden local server, backup actions, and automatic backup scheduling.

**Architecture:** Keep the existing web app and file DB unchanged, then add a tray entrypoint that starts the local HTTP server in-process. PyInstaller packages the tray app plus web assets into a distributable folder, and the same executable handles scheduled backup via a `--backup-now` argument.

**Tech Stack:** Python stdlib HTTP server/storage, pystray/Pillow for Windows tray UI, PyInstaller for Windows packaging, Windows `schtasks.exe` for 18:30 backup registration.

---

### Task 1: Refactor Server Lifecycle

**Files:**
- Modify: `scripts/server.py`

- [x] Expose `create_server()`, `open_app()`, `run_forever()`, and `run_in_thread()` so tray code can start and stop the server without a console.
- [x] Keep existing CLI behavior for development.
- [x] Preserve duplicate-start behavior: if port `8765` is already open, only open the browser and exit.

### Task 2: Add Tray App Entrypoint

**Files:**
- Create: `scripts/tray_app.py`

- [x] Add tray menu actions: open, backup now, open backup folder, register schedule, unregister schedule, exit.
- [x] Add `--backup-now`, `--install-schedule`, and `--remove-schedule` CLI modes for packaged execution.
- [x] Use the executable path for scheduled backup so the real user PC does not need Python.

### Task 3: Add Build Script and Distribution Layout

**Files:**
- Create: `scripts/build_release.ps1`
- Modify: `.gitignore`

- [x] Package the tray app with PyInstaller in `onedir` mode.
- [x] Include web files, `pages`, `data/clean.json`, and documentation in the release folder.
- [x] Keep runtime DB/backups outside source control.

### Task 4: Update User Documentation

**Files:**
- Modify: `docs/RUNBOOK.md`

- [x] Document the `.exe` workflow for non-developers.
- [x] Document tray menu actions and automatic backup registration.
- [x] Clarify that the old VBS files are development fallbacks, not the recommended production workflow.

### Task 5: Verify

**Commands:**
- `python -m py_compile scripts\storage.py scripts\server.py scripts\backup.py scripts\tray_app.py`
- `python -m unittest tests\storage_test.py`
- `node --test tests\data-service.test.js tests\ui-regressions.test.js`
- `powershell -ExecutionPolicy Bypass -File scripts\build_release.ps1`

- [x] Confirm the release folder contains `잉크 재고 시스템.exe`, `data`, and docs.
