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


class OptimisticConcurrencyTest(unittest.TestCase):
    """compute_rev / write_current_checked — 다중 탭 lost-update 방지(OCC)."""

    def _setup_current(self, td, content):
        db = Path(td) / "db"
        backups = Path(td) / "backups"
        seed = Path(td) / "clean.json"
        db.mkdir()
        backups.mkdir()
        seed.write_text("{}", encoding="utf-8")
        current = db / "current.json"
        current.write_text(json.dumps(content), encoding="utf-8")
        return db, backups, seed, current

    def test_compute_rev_is_key_order_independent(self):
        # 키 순서가 달라도 내용이 같으면 동일 rev (멱등)
        self.assertEqual(
            storage.compute_rev({"a": 1, "b": [2, 3]}),
            storage.compute_rev({"b": [2, 3], "a": 1}),
        )

    def test_compute_rev_changes_on_content_change(self):
        self.assertNotEqual(storage.compute_rev({"v": 1}), storage.compute_rev({"v": 2}))

    def test_checked_write_with_matching_rev_succeeds(self):
        with tempfile.TemporaryDirectory() as td:
            db, backups, seed, current = self._setup_current(td, {"v": 1})
            with patch.object(storage, "DB_DIR", db), patch.object(storage, "BACKUP_DIR", backups), patch.object(storage, "SEED_FILE", seed), patch.object(storage, "CURRENT_FILE", current):
                base = storage.compute_rev(storage.read_json(current))
                new_rev = storage.write_current_checked({"v": 2}, base)
                self.assertEqual(storage.read_json(current)["v"], 2)
                self.assertEqual(new_rev, storage.compute_rev({"v": 2}))

    def test_checked_write_with_stale_rev_raises_and_keeps_file(self):
        with tempfile.TemporaryDirectory() as td:
            db, backups, seed, current = self._setup_current(td, {"v": 1})
            with patch.object(storage, "DB_DIR", db), patch.object(storage, "BACKUP_DIR", backups), patch.object(storage, "SEED_FILE", seed), patch.object(storage, "CURRENT_FILE", current):
                with self.assertRaises(storage.ConflictError) as ctx:
                    storage.write_current_checked({"v": 2}, "stalerev0000")
                # 충돌 응답에 현재 rev 동반
                self.assertEqual(ctx.exception.current_rev, storage.compute_rev({"v": 1}))
                # 파일은 덮어쓰이지 않음 (lost-update 차단)
                self.assertEqual(storage.read_json(current)["v"], 1)

    def test_checked_write_none_base_is_unconditional(self):
        # base_rev=None → 폴백/레거시 호환: 무조건 기록
        with tempfile.TemporaryDirectory() as td:
            db, backups, seed, current = self._setup_current(td, {"v": 1})
            with patch.object(storage, "DB_DIR", db), patch.object(storage, "BACKUP_DIR", backups), patch.object(storage, "SEED_FILE", seed), patch.object(storage, "CURRENT_FILE", current):
                storage.write_current_checked({"v": 9}, None)
                self.assertEqual(storage.read_json(current)["v"], 9)


class AuditTrailTest(unittest.TestCase):
    """diff_audit / append_audit / read_audit — 변경 감사 로그(append-only)."""

    def _patch_audit(self, td):
        db = Path(td) / "db"
        db.mkdir()
        return patch.object(storage, "AUDIT_FILE", db / "audit.json")

    def _setup_current(self, td, content):
        db = Path(td) / "db"
        backups = Path(td) / "backups"
        seed = Path(td) / "clean.json"
        db.mkdir()
        backups.mkdir()
        seed.write_text("{}", encoding="utf-8")
        current = db / "current.json"
        current.write_text(json.dumps(content), encoding="utf-8")
        return db, backups, seed, current

    def test_diff_injection_add_change_remove(self):
        before = {"injection": {"3층": [
            {"machine": "10호기", "schedule": {"월": {"day": "OLD", "night": "GONE"}}},
        ]}}
        after = {"injection": {"3층": [
            {"machine": "10호기", "schedule": {"월": {"day": "NEW", "night": ""}}},
        ]}}
        changes = {c["field"]: c for c in storage.diff_audit(before, after)}
        self.assertEqual(changes["injection·3층·10호기·월·day"]["before"], "OLD")
        self.assertEqual(changes["injection·3층·10호기·월·day"]["after"], "NEW")
        # night: GONE → 빈 셀(삭제) — after 측 키가 없으므로 None
        self.assertEqual(changes["injection·3층·10호기·월·night"]["before"], "GONE")
        self.assertIsNone(changes["injection·3층·10호기·월·night"]["after"])

    def test_diff_products_and_assignments(self):
        before = {
            "products": [{"name": "A", "brand": "PIA", "inks": ["i1"]}],
            "machineAssignments": [{"ink": "i1", "machine": "10호기", "code": ""}],
        }
        after = {
            "products": [{"name": "A", "brand": "PIA", "inks": ["i1", "i2"]}],
            "machineAssignments": [{"ink": "i1", "machine": "10호기", "code": "INK-001"}],
        }
        changes = {c["field"]: c for c in storage.diff_audit(before, after)}
        self.assertEqual(changes["products·A"]["before"], "PIA|i1")
        self.assertEqual(changes["products·A"]["after"], "PIA|i1,i2")
        self.assertEqual(changes["machineAssignments·i1"]["before"], "10호기|")
        self.assertEqual(changes["machineAssignments·i1"]["after"], "10호기|INK-001")

    def test_diff_no_change_is_empty(self):
        data = {"injection": {"3층": [{"machine": "10호기", "schedule": {"월": {"day": "X"}}}]},
                "products": [{"name": "A", "brand": "PIA", "inks": ["i1"]}]}
        # 동일 내용(키 순서만 달라도) → 변경 0건
        self.assertEqual(storage.diff_audit(data, json.loads(json.dumps(data))), [])

    def test_diff_ignores_untracked_fields(self):
        # inventory/inkPlan 등 추적 대상 외 변경은 무시
        before = {"inventory": {"daily": {}}, "products": []}
        after = {"inventory": {"daily": {"2026-06-15": {"L1": 5}}}, "products": []}
        self.assertEqual(storage.diff_audit(before, after), [])

    def test_append_and_read_accumulate(self):
        with tempfile.TemporaryDirectory() as td:
            with self._patch_audit(td):
                n1 = storage.append_audit(
                    [{"field": "products·A", "before": None, "after": "x"}], "products", ts="2026-06-15T10:00:00")
                n2 = storage.append_audit(
                    [{"field": "products·B", "before": "y", "after": "z"}], "machines", ts="2026-06-15T11:00:00")
                self.assertEqual((n1, n2), (1, 1))
                log = storage.read_audit()
                self.assertEqual(len(log), 2)
                self.assertEqual(log[0]["source"], "products")  # 누적 순서(시간순)
                self.assertEqual(log[1]["field"], "products·B")
                self.assertEqual(storage.read_audit(limit=1)[0]["field"], "products·B")  # 마지막 1건

    def test_append_empty_changes_is_noop(self):
        with tempfile.TemporaryDirectory() as td:
            with self._patch_audit(td):
                self.assertEqual(storage.append_audit([], "web"), 0)
                self.assertEqual(storage.read_audit(), [])
                self.assertFalse(storage.AUDIT_FILE.exists())  # 빈 변경은 파일조차 만들지 않음

    def test_read_audit_corrupt_returns_empty(self):
        with tempfile.TemporaryDirectory() as td:
            with self._patch_audit(td):
                storage.AUDIT_FILE.write_text("{bad json", encoding="utf-8")
                self.assertEqual(storage.read_audit(), [])  # 손상 시 throw 없이 []

    def test_write_current_checked_appends_audit_when_source(self):
        with tempfile.TemporaryDirectory() as td:
            db, backups, seed, current = self._setup_current(
                td, {"products": [{"name": "A", "brand": "PIA", "inks": ["i1"]}]})
            with patch.object(storage, "DB_DIR", db), patch.object(storage, "BACKUP_DIR", backups), \
                 patch.object(storage, "SEED_FILE", seed), patch.object(storage, "CURRENT_FILE", current), \
                 patch.object(storage, "AUDIT_FILE", db / "audit.json"):
                base = storage.compute_rev(storage.read_json(current))
                storage.write_current_checked(
                    {"products": [{"name": "A", "brand": "PIA", "inks": ["i1", "i2"]}]}, base, source="products")
                log = storage.read_audit()
                self.assertEqual(len(log), 1)
                self.assertEqual(log[0]["field"], "products·A")
                self.assertEqual(log[0]["source"], "products")

    def test_write_current_checked_no_source_no_audit(self):
        with tempfile.TemporaryDirectory() as td:
            db, backups, seed, current = self._setup_current(td, {"v": 1})
            with patch.object(storage, "DB_DIR", db), patch.object(storage, "BACKUP_DIR", backups), \
                 patch.object(storage, "SEED_FILE", seed), patch.object(storage, "CURRENT_FILE", current), \
                 patch.object(storage, "AUDIT_FILE", db / "audit.json"):
                storage.write_current_checked({"v": 2}, None)  # source 없음
                self.assertEqual(storage.read_audit(), [])

    def test_audit_failure_does_not_block_save(self):
        # 감사 로그 기록이 실패해도 본 저장(current.json)은 정상 커밋되어야 한다(best-effort).
        with tempfile.TemporaryDirectory() as td:
            db, backups, seed, current = self._setup_current(
                td, {"products": [{"name": "A", "brand": "PIA", "inks": ["i1"]}]})
            with patch.object(storage, "DB_DIR", db), patch.object(storage, "BACKUP_DIR", backups), \
                 patch.object(storage, "SEED_FILE", seed), patch.object(storage, "CURRENT_FILE", current), \
                 patch.object(storage, "append_audit", side_effect=RuntimeError("disk full")):
                base = storage.compute_rev(storage.read_json(current))
                new_after = {"products": [{"name": "A", "brand": "PIA", "inks": ["i1", "i2"]}]}
                rev = storage.write_current_checked(new_after, base, source="products")
                self.assertEqual(rev, storage.compute_rev(new_after))
                self.assertEqual(storage.read_json(current)["products"][0]["inks"], ["i1", "i2"])


if __name__ == "__main__":
    unittest.main()
