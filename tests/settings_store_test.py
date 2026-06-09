"""settings_store.py 단위 테스트.

write_settings 의 단일 read-modify-write 정합성과 apiKey/model 처리 검증.
SETTINGS_FILE 을 임시 경로로 patch 하여 실제 settings.json 을 건드리지 않는다.
"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import settings_store


class SettingsStoreTest(unittest.TestCase):
    def _patch(self, td):
        return patch.object(settings_store, "SETTINGS_FILE", Path(td) / "settings.json")

    def test_round_trip_sets_key_and_defaults_model(self):
        with tempfile.TemporaryDirectory() as td, self._patch(td):
            result = settings_store.write_settings({"apiKey": "X", "model": ""})
            self.assertEqual(result["apiKey"], "X")
            self.assertEqual(result["model"], settings_store.DEFAULT_MODEL)
            again = settings_store.read_settings()
            self.assertEqual(again["apiKey"], "X")
            self.assertEqual(again["model"], settings_store.DEFAULT_MODEL)

    def test_empty_api_key_removes_key(self):
        with tempfile.TemporaryDirectory() as td, self._patch(td):
            settings_store.write_settings({"apiKey": "X", "model": "M"})
            settings_store.write_settings({"apiKey": "  ", "model": "M"})  # 공백 → 제거
            with settings_store.SETTINGS_FILE.open(encoding="utf-8") as f:
                file_data = json.load(f)
            self.assertNotIn("apiKey", file_data)
            self.assertEqual(settings_store.read_settings()["apiKey"], "")

    def test_single_write_persists_both_fields(self):
        # 이중 write 제거 → 파일에 model·apiKey 가 한 번에 함께 기록(반쪽 상태 없음)
        with tempfile.TemporaryDirectory() as td, self._patch(td):
            settings_store.write_settings({"apiKey": "X", "model": "M"})
            with settings_store.SETTINGS_FILE.open(encoding="utf-8") as f:
                file_data = json.load(f)
            self.assertEqual(file_data.get("model"), "M")
            self.assertEqual(file_data.get("apiKey"), "X")

    def test_read_missing_file_returns_defaults(self):
        with tempfile.TemporaryDirectory() as td, self._patch(td):
            result = settings_store.read_settings()  # 파일 없음
            self.assertEqual(result["apiKey"], "")
            self.assertEqual(result["model"], settings_store.DEFAULT_MODEL)

    def test_blank_model_falls_back_to_default(self):
        with tempfile.TemporaryDirectory() as td, self._patch(td):
            settings_store.write_settings({"model": "   "})
            self.assertEqual(settings_store.read_settings()["model"], settings_store.DEFAULT_MODEL)


if __name__ == "__main__":
    unittest.main()
