import argparse
import ctypes
import os
import subprocess
import sys
import time
from pathlib import Path

import pystray
from PIL import Image, ImageDraw

from storage import BACKUP_DIR, ROOT, create_backup, prune_backups
from server import open_app, port_is_open, run_in_thread


TASK_NAME = "InkPlanDailyBackup"
BACKUP_TIME = "18:30"
APP_NAME = "잉크 재고 시스템"


def message(title, text):
    ctypes.windll.user32.MessageBoxW(0, text, title, 0x40)


def error(title, text):
    ctypes.windll.user32.MessageBoxW(0, text, title, 0x10)


def exe_command():
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --backup-now'
    script = Path(__file__).resolve()
    return f'"{sys.executable}" "{script}" --backup-now'


def task_exists():
    result = subprocess.run(
        ["schtasks.exe", "/Query", "/TN", TASK_NAME],
        capture_output=True,
        text=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    return result.returncode == 0


def install_schedule():
    task_run = exe_command()
    result = subprocess.run(
        ["schtasks.exe", "/Create", "/TN", TASK_NAME, "/TR", task_run, "/SC", "DAILY", "/ST", BACKUP_TIME, "/F"],
        capture_output=True,
        text=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "").strip())


def remove_schedule():
    result = subprocess.run(
        ["schtasks.exe", "/Delete", "/TN", TASK_NAME, "/F"],
        capture_output=True,
        text=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if result.returncode != 0 and task_exists():
        raise RuntimeError((result.stderr or result.stdout or "").strip())


def backup_now(label="manual"):
    target = create_backup(label)
    prune_backups()
    return target


def open_backup_folder():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    os.startfile(str(BACKUP_DIR))


def make_icon():
    image = Image.new("RGBA", (64, 64), (20, 83, 136, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((10, 10, 54, 54), radius=10, fill=(255, 255, 255, 255))
    draw.rectangle((20, 18, 44, 44), fill=(20, 83, 136, 255))
    draw.rectangle((25, 12, 39, 18), fill=(20, 83, 136, 255))
    draw.ellipse((26, 45, 38, 57), fill=(20, 83, 136, 255))
    return image


class TrayApp:
    def __init__(self):
        self.httpd = None
        self.thread = None
        self.icon = pystray.Icon(APP_NAME, make_icon(), APP_NAME, self.menu())

    def menu(self):
        return pystray.Menu(
            pystray.MenuItem("열기", self.on_open, default=True),
            pystray.MenuItem("지금 백업", self.on_backup),
            pystray.MenuItem("백업 폴더 열기", self.on_open_backup_folder),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("자동 백업 등록 (18:30)", self.on_install_schedule),
            pystray.MenuItem("자동 백업 해제", self.on_remove_schedule),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("종료", self.on_exit),
        )

    def start_server(self):
        if port_is_open():
            open_app()
            return False
        self.httpd, self.thread = run_in_thread(open_browser=True)
        return True

    def run(self):
        started = self.start_server()
        if not started:
            return
        self.icon.run()

    def on_open(self, icon=None, item=None):
        open_app()

    def on_backup(self, icon=None, item=None):
        try:
            target = backup_now("manual")
            message(APP_NAME, f"백업을 만들었습니다.\n\n{target.name}")
        except Exception as exc:
            error(APP_NAME, f"백업에 실패했습니다.\n\n{exc}")

    def on_open_backup_folder(self, icon=None, item=None):
        open_backup_folder()

    def on_install_schedule(self, icon=None, item=None):
        try:
            install_schedule()
            message(APP_NAME, f"자동 백업을 등록했습니다.\n매일 {BACKUP_TIME}에 실행됩니다.")
        except Exception as exc:
            error(APP_NAME, f"자동 백업 등록에 실패했습니다.\n\n{exc}")

    def on_remove_schedule(self, icon=None, item=None):
        try:
            remove_schedule()
            message(APP_NAME, "자동 백업을 해제했습니다.")
        except Exception as exc:
            error(APP_NAME, f"자동 백업 해제에 실패했습니다.\n\n{exc}")

    def on_exit(self, icon=None, item=None):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
        self.icon.stop()


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backup-now", action="store_true")
    parser.add_argument("--install-schedule", action="store_true")
    parser.add_argument("--remove-schedule", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    if args.backup_now:
        backup_now("scheduled")
        return
    if args.install_schedule:
        install_schedule()
        return
    if args.remove_schedule:
        remove_schedule()
        return
    TrayApp().run()
    time.sleep(0.1)


if __name__ == "__main__":
    main()
