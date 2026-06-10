import hashlib
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


class ConflictError(Exception):
    """낙관적 동시성 제어(OCC): base_rev 가 현재 rev 와 불일치.
    다른 탭/창이 먼저 저장해 lost-update 가 발생할 상황을 의미한다."""

    def __init__(self, current_rev):
        super().__init__("revision conflict")
        self.current_rev = current_rev


def compute_rev(data):
    # 내용 기반 리비전(content hash) — 카운터 파일/데이터 모델 오염 없이 재시작에도 안정.
    # 키 순서 무관 정규화 후 해시 → 동일 내용은 동일 rev(멱등). 16자 절단으로 충분.
    canonical = json.dumps(
        data, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()[:16]


def current_rev():
    with _LOCK:
        ensure_current()
        return compute_rev(read_json(CURRENT_FILE))


def write_current_checked(data, base_rev):
    # base_rev=None 이면 무조건 기록(시드 폴백/레거시 클라이언트 호환).
    # 값이 있으면 현재 rev 와 일치할 때만 기록, 불일치 시 ConflictError 로 거부한다.
    # read-rev→compare→write 를 단일 _LOCK 안에서 수행해 TOCTOU 를 차단한다.
    with _LOCK:
        ensure_current()
        cur = compute_rev(read_json(CURRENT_FILE))
        if base_rev is not None and base_rev != cur:
            raise ConflictError(cur)
        write_json_atomic(CURRENT_FILE, data)
        return compute_rev(data)


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
    # 파일명(타임스탬프)이 아닌 실제 수정시각 기준 최신순으로 정렬한다.
    # 파일명 정렬은 _manual/_before_restore/-2 같은 접미사가 붙으면 시간순과
    # 어긋나, 보존 로테이션이 의미 있는 백업을 먼저 지울 수 있다.
    entries = []
    for p in BACKUP_DIR.glob("*.json"):
        try:
            mtime = p.stat().st_mtime
        except OSError:
            continue  # 조회 중 삭제된 파일(TOCTOU)은 건너뜀
        entries.append((mtime, p.name, p))
    entries.sort(reverse=True)  # (mtime, name) 역순 — 동일 시각은 이름 역순 안정 정렬
    return [p for _, _, p in entries]


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


def prune_backups(keep=90, keep_startup=20):
    # 매 실행마다 쌓이는 startup 백업이 manual/before_*/scheduled 같은 의미 있는
    # 스냅샷을 조기에 밀어내지 않도록 분리 보존한다.
    backups = list_backups()  # 최신순(이름 역순)
    startup = [p for p in backups if "_startup" in p.stem]
    important = [p for p in backups if "_startup" not in p.stem]
    removed = 0
    for path in startup[keep_startup:]:
        path.unlink(missing_ok=True)
        removed += 1
    for path in important[keep:]:
        path.unlink(missing_ok=True)
        removed += 1
    return removed
