"""offsite_backup — 오프사이트 미러링 단위 테스트.

storage 경로를 임시 디렉터리로 격리해 실데이터를 건드리지 않고,
미설정 no-op / 설정 시 미러링 / 증분 복사를 검증한다.
"""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import offsite_backup


class OffsiteBackupTest(unittest.TestCase):
    def _setup_src(self, td):
        """임시 소스(현재 DB + 백업 3개) 구성 후 offsite_backup 모듈 경로를 그쪽으로 패치."""
        db = Path(td) / "db"
        backups = Path(td) / "backups"
        logs = Path(td) / "logs"
        db.mkdir()
        backups.mkdir()
        current = db / "current.json"
        current.write_text(json.dumps({"v": 1, "products": []}), encoding="utf-8")
        made = []
        for i in range(3):
            p = backups / f"2026-06-1{i}_snap.json"
            p.write_text(json.dumps({"snap": i}), encoding="utf-8")
            made.append(p)
        # list_backups 규약: 최신순
        made_sorted = sorted(made, reverse=True)
        return [
            patch.object(offsite_backup, "CURRENT_FILE", current),
            patch.object(offsite_backup, "BACKUP_DIR", backups),
            patch.object(offsite_backup, "LOG_FILE", logs / "offsite.log"),
            patch.object(offsite_backup, "list_backups", lambda: made_sorted),
        ]

    def test_noop_when_unconfigured(self):
        with tempfile.TemporaryDirectory() as td:
            patches = self._setup_src(td)
            for p in patches:
                p.start()
            try:
                with patch.dict(os.environ, {}, clear=False):
                    os.environ.pop("INK_PLAN_OFFSITE_DIR", None)
                    with patch.object(offsite_backup, "read_settings", lambda: {}):
                        ok, msg = offsite_backup.sync_offsite()
            finally:
                for p in patches:
                    p.stop()
            self.assertFalse(ok)
            self.assertIn("설정", msg)

    def test_mirrors_when_configured_via_env(self):
        with tempfile.TemporaryDirectory() as td, tempfile.TemporaryDirectory() as dest:
            patches = self._setup_src(td)
            for p in patches:
                p.start()
            try:
                with patch.dict(os.environ, {"INK_PLAN_OFFSITE_DIR": dest}):
                    ok, msg = offsite_backup.sync_offsite()
            finally:
                for p in patches:
                    p.stop()
            self.assertTrue(ok, msg)
            target = Path(dest) / "ink_plan"
            self.assertTrue((target / "current.json").exists())
            mirrored = list((target / "backups").glob("*.json"))
            self.assertEqual(len(mirrored), 3)

    def test_incremental_second_run_copies_nothing_new(self):
        with tempfile.TemporaryDirectory() as td, tempfile.TemporaryDirectory() as dest:
            patches = self._setup_src(td)
            for p in patches:
                p.start()
            try:
                with patch.dict(os.environ, {"INK_PLAN_OFFSITE_DIR": dest}):
                    offsite_backup.sync_offsite()
                    ok, msg = offsite_backup.sync_offsite()
            finally:
                for p in patches:
                    p.stop()
            self.assertTrue(ok, msg)
            self.assertIn("신규 0건", msg)

    def test_settings_fallback_when_no_env(self):
        with tempfile.TemporaryDirectory() as td, tempfile.TemporaryDirectory() as dest:
            patches = self._setup_src(td)
            for p in patches:
                p.start()
            try:
                with patch.dict(os.environ, {}, clear=False):
                    os.environ.pop("INK_PLAN_OFFSITE_DIR", None)
                    with patch.object(offsite_backup, "read_settings", lambda: {"offsiteBackupDir": dest}):
                        ok, msg = offsite_backup.sync_offsite()
            finally:
                for p in patches:
                    p.stop()
            self.assertTrue(ok, msg)
            self.assertTrue((Path(dest) / "ink_plan" / "current.json").exists())


if __name__ == "__main__":
    unittest.main()
