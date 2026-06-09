import json
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import storage


class StorageTest(unittest.TestCase):
    def test_atomic_write_and_read(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "current.json"
            storage.write_json_atomic(path, {"ok": True, "name": "잉크"})
            self.assertEqual(storage.read_json(path)["name"], "잉크")
            self.assertFalse(path.with_suffix(".json.tmp").exists())

    def test_backup_restore_keeps_pre_restore_copy(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = root / "db"
            backups = root / "backups"
            seed = root / "clean.json"
            db.mkdir()
            backups.mkdir()
            seed.write_text("{}", encoding="utf-8")
            current = db / "current.json"
            current.write_text(json.dumps({"version": 1}), encoding="utf-8")

            with patch.object(storage, "DB_DIR", db), patch.object(storage, "BACKUP_DIR", backups), patch.object(storage, "SEED_FILE", seed), patch.object(storage, "CURRENT_FILE", current):
                backup = storage.create_backup("manual")
                current.write_text(json.dumps({"version": 2}), encoding="utf-8")
                storage.restore_backup(backup.name)
                self.assertEqual(storage.read_json(current)["version"], 1)
                self.assertTrue(any("before_restore" in p.name for p in backups.glob("*.json")))

    def test_backups_created_in_same_second_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = root / "db"
            backups = root / "backups"
            seed = root / "clean.json"
            db.mkdir()
            backups.mkdir()
            seed.write_text("{}", encoding="utf-8")
            current = db / "current.json"
            current.write_text(json.dumps({"version": 1}), encoding="utf-8")
            now = datetime(2026, 5, 19, 10, 30, 0)

            with patch.object(storage, "DB_DIR", db), patch.object(storage, "BACKUP_DIR", backups), patch.object(storage, "SEED_FILE", seed), patch.object(storage, "CURRENT_FILE", current):
                first = storage.create_backup("manual", now=now)
                second = storage.create_backup("manual", now=now)

            self.assertNotEqual(first.name, second.name)
            self.assertTrue(first.exists())
            self.assertTrue(second.exists())

    def test_read_backup_uses_backup_basename_only(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = root / "db"
            backups = root / "backups"
            seed = root / "clean.json"
            db.mkdir()
            backups.mkdir()
            seed.write_text("{}", encoding="utf-8")
            current = db / "current.json"
            current.write_text(json.dumps({"version": 3}), encoding="utf-8")

            with patch.object(storage, "DB_DIR", db), patch.object(storage, "BACKUP_DIR", backups), patch.object(storage, "SEED_FILE", seed), patch.object(storage, "CURRENT_FILE", current):
                backup = storage.create_backup("manual")
                self.assertEqual(storage.read_backup(f"../{backup.name}")["version"], 3)


    def test_prune_keeps_important_backups_over_startup_noise(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = root / "db"
            backups = root / "backups"
            seed = root / "clean.json"
            db.mkdir()
            backups.mkdir()
            seed.write_text("{}", encoding="utf-8")
            current = db / "current.json"
            current.write_text(json.dumps({"version": 1}), encoding="utf-8")

            with patch.object(storage, "DB_DIR", db), patch.object(storage, "BACKUP_DIR", backups), patch.object(storage, "SEED_FILE", seed), patch.object(storage, "CURRENT_FILE", current):
                # 오래된 manual 1개 + startup 25개
                storage.create_backup("manual", now=datetime(2026, 5, 1, 9, 0, 0))
                for i in range(25):
                    storage.create_backup("startup", now=datetime(2026, 5, 2, 9, i, 0))
                removed = storage.prune_backups(keep=90, keep_startup=20)

            names = [p.name for p in backups.glob("*.json")]
            startup_left = [n for n in names if "_startup" in n]
            important_left = [n for n in names if "_startup" not in n]
            self.assertEqual(len(startup_left), 20)   # startup 은 20개로 캡
            self.assertEqual(len(important_left), 1)   # 오래됐어도 manual 은 보존
            self.assertEqual(removed, 5)


    def test_list_backups_orders_by_mtime_not_filename(self):
        with tempfile.TemporaryDirectory() as td:
            backups = Path(td)
            # 이름 역순 정렬이면 'zzz'가 먼저지만, 실제 수정시각은 'aaa'가 더 최신.
            # mtime 기준 정렬이므로 'aaa'(최신)가 먼저 와야 한다.
            older = backups / "2026-01-01_000000_zzz.json"
            newer = backups / "2026-01-01_000000_aaa.json"
            older.write_text("{}", encoding="utf-8")
            newer.write_text("{}", encoding="utf-8")
            os.utime(older, (1000, 1000))  # 과거
            os.utime(newer, (2000, 2000))  # 최신
            with patch.object(storage, "DB_DIR", backups), patch.object(storage, "BACKUP_DIR", backups):
                result = storage.list_backups()
            self.assertEqual(result[0].name, newer.name)  # 최신(mtime) 우선
            self.assertEqual(result[1].name, older.name)


if __name__ == "__main__":
    unittest.main()
