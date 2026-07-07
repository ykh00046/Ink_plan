"""오프사이트 백업 — 로컬 백업을 외부 위치(네트워크 드라이브/클라우드 폴더/USB)로 미러링.

단일 PC 고장 = 전 데이터 소실이라는 최대 리스크를 값싸게 제거한다.
목적지는 사용자별이므로 설정으로 지정한다(코드에 경로를 박지 않음):

  1) 환경변수  INK_PLAN_OFFSITE_DIR=D:\\백업  (우선)
  2) data/settings.json 의  "offsiteBackupDir": "\\\\NAS\\ink_plan"  (대안)

미설정이면 조용히 no-op(에러 아님) — 매일 백업을 절대 깨지 않는다.
운영: backup.py(매일 18:30 스케줄) 끝에서 호출되거나, 수동으로 직접 실행.
"""
import datetime
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from storage import BACKUP_DIR, CURRENT_FILE, DATA_DIR, list_backups
from settings_store import read_settings

KEEP_OFFSITE = 60          # 오프사이트에 보관할 백업 개수
LOG_FILE = DATA_DIR / "logs" / "offsite.log"


def _log(msg):
    # 관측 공백 보완 — 실패해도 백업 자체는 진행되도록 best-effort.
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(f"{ts}  {msg}\n")
    except Exception:
        pass


def offsite_dir():
    # 환경변수 우선, 없으면 settings.json. 빈 문자열/공백은 미설정으로 간주.
    env = (os.environ.get("INK_PLAN_OFFSITE_DIR") or "").strip()
    if env:
        return env
    try:
        return (read_settings().get("offsiteBackupDir") or "").strip()
    except Exception:
        return ""


def _copy_atomic(src: Path, dst: Path):
    # 부분 파일 노출 방지: 임시로 복사 후 교체.
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".tmp")
    shutil.copy2(src, tmp)
    os.replace(tmp, dst)


def sync_offsite():
    """현재 DB + 최근 백업들을 오프사이트로 미러링. 반환: (ok, message)."""
    dest_raw = offsite_dir()
    if not dest_raw:
        _log("skip: 오프사이트 목적지 미설정(INK_PLAN_OFFSITE_DIR 또는 settings.offsiteBackupDir)")
        return False, "오프사이트 목적지가 설정되지 않았습니다"

    dest = Path(dest_raw)
    # 목적지 상위가 존재해야 함(네트워크/USB 미마운트 시 조용히 실패 처리 — 백업은 안 깨짐).
    if not dest.parent.exists() and not dest.exists():
        _log(f"skip: 목적지 접근 불가 {dest} (드라이브 미연결?)")
        return False, f"목적지에 접근할 수 없습니다: {dest}"

    try:
        target = dest / "ink_plan"
        (target / "backups").mkdir(parents=True, exist_ok=True)

        # 1) 현재 DB 스냅샷
        if CURRENT_FILE.exists():
            _copy_atomic(CURRENT_FILE, target / "current.json")

        # 2) 최근 백업들 — 목적지에 없는 것만 복사(증분)
        backups = list_backups()  # 최신순(storage 규약)
        copied = 0
        for p in backups[:KEEP_OFFSITE]:
            d = target / "backups" / p.name
            if not d.exists() or d.stat().st_size != p.stat().st_size:
                _copy_atomic(p, d)
                copied += 1

        # 3) 목적지 백업 로테이션(최근 KEEP_OFFSITE개 유지)
        existing = sorted(
            (target / "backups").glob("*.json"),
            key=lambda x: x.stat().st_mtime,
            reverse=True,
        )
        removed = 0
        for old in existing[KEEP_OFFSITE:]:
            try:
                old.unlink()
                removed += 1
            except OSError:
                pass

        msg = f"ok: → {target}  (신규 {copied}건 복사, {removed}건 정리, DB 스냅샷 갱신)"
        _log(msg)
        return True, msg
    except Exception as exc:  # 백업 미러링 실패가 주 백업/서버를 깨지 않도록 격리
        _log(f"error: {exc!r}")
        return False, f"오프사이트 백업 실패: {exc}"


def main():
    ok, msg = sync_offsite()
    print(msg)
    # 미설정/미연결은 정상 종료(0) — 스케줄 작업이 실패로 뜨지 않게. 진짜 예외만 1.
    return 0 if (ok or "설정" in msg or "접근" in msg) else 1


if __name__ == "__main__":
    sys.exit(main())
