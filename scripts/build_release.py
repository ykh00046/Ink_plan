import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_NAME = "잉크 재고 시스템"
RELEASE_ROOT = ROOT / "release"
DIST_DIR = RELEASE_ROOT / APP_NAME
WORK_DIR = ROOT / "build" / "pyinstaller"
SPEC_DIR = ROOT / "build" / "pyinstaller"


def add_data_arg(source, target):
    return f"{source}{os.pathsep}{target}"


def main():
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)

    data_files = [
        (ROOT / "index.html", "."),
        (ROOT / "app.jsx", "."),
        (ROOT / "data-service.js", "."),
        (ROOT / "styles.css", "."),
        (ROOT / "tweaks-panel.jsx", "."),
        (ROOT / "ui.jsx", "."),
        (ROOT / "pages", "pages"),
        (ROOT / "data" / "clean.json", "data"),
        (ROOT / "docs" / "RUNBOOK.md", "docs"),
    ]

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconsole",
        "--clean",
        "--onedir",
        "--name",
        APP_NAME,
        "--distpath",
        str(RELEASE_ROOT),
        "--workpath",
        str(WORK_DIR),
        "--specpath",
        str(SPEC_DIR),
        "--hidden-import",
        "win32cred",
    ]

    for source, target in data_files:
        cmd.extend(["--add-data", add_data_arg(source, target)])

    cmd.append(str(ROOT / "scripts" / "tray_app.py"))
    subprocess.run(cmd, check=True, cwd=ROOT)

    shutil.copy2(ROOT / "docs" / "RUNBOOK.md", DIST_DIR / "사용 설명서.md")
    (DIST_DIR / "data").mkdir(exist_ok=True)

    print("Release created:")
    print(DIST_DIR)
    print("User executable:")
    print(DIST_DIR / f"{APP_NAME}.exe")


if __name__ == "__main__":
    main()
