import json
import os
import shutil
import sys
import threading
from datetime import datetime
from pathlib import Path


def runtime_root():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def asset_root():
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS).resolve()
    return runtime_root()


ROOT = runtime_root()
ASSET_ROOT = asset_root()
DATA_DIR = ROOT / "data"
DB_DIR = DATA_DIR / "db"
BACKUP_DIR = DATA_DIR / "backups"
SEED_FILE = ASSET_ROOT / "data" / "clean.json"
CURRENT_FILE = DB_DIR / "current.json"
_LOCK = threading.RLock()


def ensure_dirs():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def ensure_current():
    with _LOCK:
        ensure_dirs()
        if not CURRENT_FILE.exists():
            shutil.copy2(SEED_FILE, CURRENT_FILE)


def read_json(path):
    with Path(path).open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json_atomic(path, data):
    with _LOCK:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        try:
            with tmp.open("w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
            tmp.replace(path)
        finally:
            tmp.unlink(missing_ok=True)


def read_current():
    with _LOCK:
        ensure_current()
        return read_json(CURRENT_FILE)


def write_current(data):
    with _LOCK:
        ensure_current()
        write_json_atomic(CURRENT_FILE, data)


def backup_name(now=None):
    now = now or datetime.now()
    return now.strftime("%Y-%m-%d_%H%M%S.json")


def create_backup(label=None, now=None):
    with _LOCK:
        ensure_current()
        stamp = backup_name(now)
        suffix = f"_{label}" if label else ""
        stem = f"{stamp[:-5]}{suffix}"
        target = BACKUP_DIR / f"{stem}.json"
        i = 2
        while target.exists():
            target = BACKUP_DIR / f"{stem}-{i}.json"
            i += 1
        shutil.copy2(CURRENT_FILE, target)
        return target


def list_backups():
    ensure_dirs()
    return sorted(BACKUP_DIR.glob("*.json"), reverse=True)


def read_backup(name):
    ensure_dirs()
    source = BACKUP_DIR / Path(name).name
    if not source.exists():
        raise FileNotFoundError(source)
    return read_json(source)


def restore_backup(name):
    with _LOCK:
        ensure_current()
        source = BACKUP_DIR / Path(name).name
        if not source.exists():
            raise FileNotFoundError(source)
        create_backup("before_restore")
        shutil.copy2(source, CURRENT_FILE)
        return source


def prune_backups(keep=90):
    backups = list_backups()
    for path in backups[keep:]:
        path.unlink(missing_ok=True)
    return max(0, len(backups) - keep)
