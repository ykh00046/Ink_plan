"""server.py 보안 가드 단위 테스트.

Handler 의 가드 메서드(is_api_request_allowed / is_blocked_static)는
self.headers 와 self.path 만 읽으므로, 소켓 바인딩(__init__)을 우회한
Handler.__new__(Handler) 인스턴스에 헤더/경로만 주입해 단위 검증한다.
"""
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import server
import storage


def make_handler(headers=None, path="/"):
    h = server.Handler.__new__(server.Handler)
    h.headers = headers or {}
    h.path = path
    # is_blocked_static 이 translate_path()(→ self.directory) 기준으로 판정하므로 주입.
    h.directory = str(server.ASSET_ROOT)
    return h


def make_post_handler(body=b"", headers=None, path="/api/db"):
    """do_POST/read_body_json 단위 검증용 — 소켓 없이 rfile/headers 주입,
    send_json 을 스텁해 (status, payload) 를 캡처한다."""
    h = server.Handler.__new__(server.Handler)
    base = {"Host": "127.0.0.1", "Content-Length": str(len(body))}
    base.update(headers or {})
    h.headers = base
    h.path = path
    h.rfile = io.BytesIO(body)
    cap = {}
    h.send_json = lambda payload, status=200, headers=None: cap.update(
        status=status, payload=payload, headers=headers or {})
    return h, cap


def make_get_handler(path="/api/db", headers=None):
    """do_GET 단위 검증용 — send_json 스텁으로 status/payload/headers 캡처."""
    h = server.Handler.__new__(server.Handler)
    base = {"Host": "127.0.0.1"}
    base.update(headers or {})
    h.headers = base
    h.path = path
    cap = {}
    h.send_json = lambda payload, status=200, headers=None: cap.update(
        status=status, payload=payload, headers=headers or {})
    return h, cap


def _patch_storage(td, content):
    """storage 경로를 임시 디렉터리로 격리(실데이터 보호)하고 current.json 시드."""
    db = Path(td) / "db"
    backups = Path(td) / "backups"
    seed = Path(td) / "clean.json"
    db.mkdir()
    backups.mkdir()
    seed.write_text("{}", encoding="utf-8")
    current = db / "current.json"
    current.write_text(json.dumps(content), encoding="utf-8")
    return [
        patch.object(storage, "DB_DIR", db),
        patch.object(storage, "BACKUP_DIR", backups),
        patch.object(storage, "SEED_FILE", seed),
        patch.object(storage, "CURRENT_FILE", current),
        # 감사 로그도 임시 디렉터리로 격리 — POST 테스트가 실데이터 audit.json 을 오염시키지 않도록.
        patch.object(storage, "AUDIT_FILE", db / "audit.json"),
    ], current


class ApiGuardTest(unittest.TestCase):
    """is_api_request_allowed — DNS rebinding(Host) / CSRF(Origin) 방어."""

    def test_local_host_without_origin_allowed(self):
        self.assertTrue(make_handler({"Host": f"127.0.0.1:{server.PORT}"}).is_api_request_allowed())

    def test_localhost_host_allowed(self):
        self.assertTrue(make_handler({"Host": "localhost"}).is_api_request_allowed())

    def test_external_host_blocked(self):
        # DNS rebinding: 공격자 도메인이 127.0.0.1로 리바인딩돼도 Host 는 공격자 도메인
        self.assertFalse(make_handler({"Host": "evil.com"}).is_api_request_allowed())

    def test_empty_host_blocked(self):
        # Host 헤더 부재(빈 문자열)도 거부 — 비브라우저 클라이언트 방어 강화(동작 변경).
        self.assertFalse(make_handler({}).is_api_request_allowed())

    def test_same_origin_allowed(self):
        local = f"127.0.0.1:{server.PORT}"
        h = make_handler({"Host": local, "Origin": f"http://{local}"})
        self.assertTrue(h.is_api_request_allowed())

    def test_localhost_origin_allowed(self):
        local = f"localhost:{server.PORT}"
        h = make_handler({"Host": local, "Origin": f"http://{local}"})
        self.assertTrue(h.is_api_request_allowed())

    def test_cross_site_origin_blocked(self):
        # CSRF: 외부 사이트의 fetch — Origin netloc 이 로컬과 불일치
        h = make_handler({"Host": f"127.0.0.1:{server.PORT}", "Origin": "http://evil.com"})
        self.assertFalse(h.is_api_request_allowed())

    def test_cross_site_origin_with_port_blocked(self):
        h = make_handler({"Host": f"127.0.0.1:{server.PORT}", "Origin": f"http://evil.com:{server.PORT}"})
        self.assertFalse(h.is_api_request_allowed())


class BlockedStaticTest(unittest.TestCase):
    """is_blocked_static — 런타임 데이터(키/DB/백업) 정적 노출 차단."""

    def test_db_path_blocked(self):
        self.assertTrue(make_handler(path="/data/db/current.json").is_blocked_static())

    def test_backups_path_blocked(self):
        self.assertTrue(make_handler(path="/data/backups/2026.json").is_blocked_static())

    def test_settings_path_blocked(self):
        self.assertTrue(make_handler(path="/data/settings.json").is_blocked_static())

    def test_clean_json_blocked(self):
        # 시드도 정적 노출 금지 — /api/seed 로만 제공 (seed-via-api)
        self.assertTrue(make_handler(path="/data/clean.json").is_blocked_static())
        self.assertTrue(make_handler(path="/DATA/CLEAN.JSON").is_blocked_static())

    def test_sheets_json_blocked(self):
        # deny-by-default — /data/ 전체 차단(이전엔 노출됐음)
        self.assertTrue(make_handler(path="/data/sheets.json").is_blocked_static())

    def test_normal_asset_allowed(self):
        self.assertFalse(make_handler(path="/index.html").is_blocked_static())
        self.assertFalse(make_handler(path="/app.jsx").is_blocked_static())

    def test_uppercase_bypass_blocked(self):
        # 대소문자 우회 차단 (경로 소문자화)
        self.assertTrue(make_handler(path="/DATA/DB/current.json").is_blocked_static())

    def test_percent_encoded_bypass_blocked(self):
        # 퍼센트 인코딩 우회 차단 (unquote 후 비교)
        self.assertTrue(make_handler(path="/data%2Fdb/current.json").is_blocked_static())

    def test_encoded_sheets_bypass_blocked(self):
        self.assertTrue(make_handler(path="/data%2Fsheets.json").is_blocked_static())

    def test_double_slash_bypass_blocked(self):
        # //data/... — urlparse 는 data 를 netloc 으로 흡수해 프리픽스 검사를 통과했지만
        # translate_path 는 실제 data/ 파일을 연다. 판정 기준을 translate_path 로 통일해 차단.
        self.assertTrue(make_handler(path="//data/settings.json").is_blocked_static())
        self.assertTrue(make_handler(path="//data/db/current.json").is_blocked_static())

    def test_windows_trailing_dot_bypass_blocked(self):
        # /data./... — Windows 는 후행 점을 제거하고 실제 data/ 를 연다.
        self.assertTrue(make_handler(path="/data./db/current.json").is_blocked_static())
        self.assertTrue(make_handler(path="/data%2E/settings.json").is_blocked_static())

    def test_dotdot_traversal_blocked(self):
        # 루트 밖 해석(상위 탈출)은 translate_path 가 무시하지만, 판정은 deny-by-default.
        self.assertTrue(make_handler(path="/vendor/../data/settings.json").is_blocked_static())


class ReadBodyJsonTest(unittest.TestCase):
    """read_body_json — 본문 파싱/검증 (chunked·Content-Length 견고성)."""

    def test_valid_body(self):
        h, _ = make_post_handler(b'{"a": 1}')
        self.assertEqual(h.read_body_json(), {"a": 1})

    def test_empty_body_returns_none(self):
        h, _ = make_post_handler(b"")
        self.assertIsNone(h.read_body_json())

    def test_oversized_content_length_raises(self):
        h, _ = make_post_handler(b"", headers={"Content-Length": str(server.MAX_BODY_BYTES + 1)})
        with self.assertRaises(ValueError):
            h.read_body_json()

    def test_non_integer_content_length_raises(self):
        h, _ = make_post_handler(b"x", headers={"Content-Length": "abc"})
        with self.assertRaises(ValueError):
            h.read_body_json()

    def test_chunked_transfer_raises(self):
        h, _ = make_post_handler(b'{"a":1}', headers={"Transfer-Encoding": "chunked"})
        with self.assertRaises(ValueError):
            h.read_body_json()


class PostErrorMappingTest(unittest.TestCase):
    """do_POST — 예외→상태코드 매핑 (정보 노출 없는 일반 메시지)."""

    def test_non_dict_body_400(self):
        h, cap = make_post_handler(b"123", path="/api/db")  # int → dict 아님
        h.do_POST()
        self.assertEqual(cap["status"], 400)

    def test_broken_json_400(self):
        h, cap = make_post_handler(b"{bad", path="/api/db")
        h.do_POST()
        self.assertEqual(cap["status"], 400)

    def test_oversized_400(self):
        h, cap = make_post_handler(
            b"", headers={"Content-Length": str(server.MAX_BODY_BYTES + 1)}, path="/api/db")
        h.do_POST()
        self.assertEqual(cap["status"], 400)

    def test_non_integer_content_length_400(self):
        h, cap = make_post_handler(b"x", headers={"Content-Length": "abc"}, path="/api/db")
        h.do_POST()
        self.assertEqual(cap["status"], 400)

    def test_chunked_400(self):
        h, cap = make_post_handler(
            b'{"a":1}', headers={"Transfer-Encoding": "chunked"}, path="/api/db")
        h.do_POST()
        self.assertEqual(cap["status"], 400)

    def test_restore_missing_backup_404(self):
        h, cap = make_post_handler(b'{"name": "none.json"}', path="/api/restore")
        with patch.object(server, "restore_backup", side_effect=FileNotFoundError("/abs/none.json")):
            h.do_POST()
        self.assertEqual(cap["status"], 404)
        self.assertNotIn("/abs", str(cap["payload"]))  # 절대경로 미노출

    def test_external_host_403(self):
        h, cap = make_post_handler(b'{"a":1}', headers={"Host": "evil.com"}, path="/api/db")
        h.do_POST()
        self.assertEqual(cap["status"], 403)


class DbRevisionTest(unittest.TestCase):
    """ETag/If-Match 낙관적 동시성(OCC) — GET ETag 노출, POST 409 충돌."""

    def test_get_db_includes_etag_header(self):
        with tempfile.TemporaryDirectory() as td:
            patches, current = _patch_storage(td, {"products": [1]})
            for p in patches:
                p.start()
            try:
                h, cap = make_get_handler("/api/db")
                h.do_GET()
            finally:
                for p in patches:
                    p.stop()
            self.assertEqual(cap["status"], 200)
            self.assertIn("ETag", cap["headers"])
            expected = storage.compute_rev({"products": [1]})
            self.assertEqual(cap["headers"]["ETag"], f'"{expected}"')

    def test_post_matching_if_match_writes_200_with_rev(self):
        with tempfile.TemporaryDirectory() as td:
            patches, current = _patch_storage(td, {"v": 1})
            for p in patches:
                p.start()
            try:
                rev = storage.compute_rev(storage.read_json(current))
                body = json.dumps({"v": 2}).encode("utf-8")
                h, cap = make_post_handler(body, headers={"If-Match": f'"{rev}"'}, path="/api/db")
                h.do_POST()
                self.assertEqual(cap["status"], 200)
                self.assertIn("rev", cap["payload"])
                self.assertEqual(storage.read_json(current)["v"], 2)
            finally:
                for p in patches:
                    p.stop()

    def test_post_stale_if_match_returns_409(self):
        with tempfile.TemporaryDirectory() as td:
            patches, current = _patch_storage(td, {"v": 1})
            for p in patches:
                p.start()
            try:
                body = json.dumps({"v": 2}).encode("utf-8")
                h, cap = make_post_handler(
                    body, headers={"If-Match": '"stalerev0000"'}, path="/api/db")
                h.do_POST()
                self.assertEqual(cap["status"], 409)
                self.assertEqual(cap["payload"]["error"], "conflict")
                self.assertIn("rev", cap["payload"])
                # 충돌 시 파일은 보존(lost-update 차단)
                self.assertEqual(storage.read_json(current)["v"], 1)
            finally:
                for p in patches:
                    p.stop()

    def test_post_without_if_match_rejected_428(self):
        # If-Match 부재 → 428 거부. 무조건 기록을 허용하면 stale 탭(폴백 로드 등)이
        # 다른 사용자의 최신 편집을 409 없이 통째로 덮어쓴다(OCC 우회).
        with tempfile.TemporaryDirectory() as td:
            patches, current = _patch_storage(td, {"v": 1})
            for p in patches:
                p.start()
            try:
                body = json.dumps({"v": 7}).encode("utf-8")
                h, cap = make_post_handler(body, path="/api/db")
                h.do_POST()
                self.assertEqual(cap["status"], 428)
                # 거부 시 파일 보존
                self.assertEqual(storage.read_json(current)["v"], 1)
            finally:
                for p in patches:
                    p.stop()


class WeekSnapshotApiTest(unittest.TestCase):
    """주간 스냅샷 API — POST 적재 / GET 목록·읽기 / 잘못된 주·부재 처리."""

    def test_post_creates_and_get_reads_back(self):
        with tempfile.TemporaryDirectory() as td:
            patches, current = _patch_storage(td, {"v": 1})
            patches.append(patch.object(storage, "ARCHIVE_DIR", Path(td) / "archive"))
            for p in patches:
                p.start()
            try:
                body = json.dumps({"week": "2026-W28", "data": {"products": [{"id": "p_1"}]}}).encode("utf-8")
                h, cap = make_post_handler(body, path="/api/snapshot")
                h.do_POST()
                self.assertEqual(cap["status"], 200)
                self.assertEqual(cap["payload"]["week"], "2026-W28")

                h2, cap2 = make_get_handler("/api/snapshots")
                h2.do_GET()
                self.assertEqual(cap2["status"], 200)
                self.assertEqual([e["week"] for e in cap2["payload"]], ["2026-W28"])

                h3, cap3 = make_get_handler("/api/snapshot?week=2026-W28")
                h3.do_GET()
                self.assertEqual(cap3["status"], 200)
                self.assertEqual(cap3["payload"]["products"][0]["id"], "p_1")
            finally:
                for p in patches:
                    p.stop()

    def test_post_bad_week_400(self):
        with tempfile.TemporaryDirectory() as td:
            patches, current = _patch_storage(td, {"v": 1})
            patches.append(patch.object(storage, "ARCHIVE_DIR", Path(td) / "archive"))
            for p in patches:
                p.start()
            try:
                body = json.dumps({"week": "../evil", "data": {}}).encode("utf-8")
                h, cap = make_post_handler(body, path="/api/snapshot")
                h.do_POST()
                self.assertEqual(cap["status"], 400)
            finally:
                for p in patches:
                    p.stop()

    def test_get_missing_snapshot_404(self):
        with tempfile.TemporaryDirectory() as td:
            patches, current = _patch_storage(td, {"v": 1})
            patches.append(patch.object(storage, "ARCHIVE_DIR", Path(td) / "archive"))
            for p in patches:
                p.start()
            try:
                h, cap = make_get_handler("/api/snapshot?week=2099-W01")
                h.do_GET()
                self.assertEqual(cap["status"], 404)
            finally:
                for p in patches:
                    p.stop()


class SeedApiTest(unittest.TestCase):
    """GET /api/seed — 시드(clean.json)를 정적 노출 대신 API 로 제공."""

    def test_get_seed_returns_seed_content(self):
        with tempfile.TemporaryDirectory() as td:
            patches, current = _patch_storage(td, {"v": 1})
            (Path(td) / "clean.json").write_text(
                json.dumps({"seed": True}), encoding="utf-8")
            for p in patches:
                p.start()
            try:
                h, cap = make_get_handler("/api/seed")
                h.do_GET()
            finally:
                for p in patches:
                    p.stop()
            self.assertEqual(cap["status"], 200)
            self.assertEqual(cap["payload"], {"seed": True})

    def test_get_seed_missing_file_404(self):
        with tempfile.TemporaryDirectory() as td:
            patches, current = _patch_storage(td, {"v": 1})
            (Path(td) / "clean.json").unlink()  # 시드 제거
            for p in patches:
                p.start()
            try:
                h, cap = make_get_handler("/api/seed")
                h.do_GET()
            finally:
                for p in patches:
                    p.stop()
            self.assertEqual(cap["status"], 404)


class AuditApiTest(unittest.TestCase):
    """GET /api/audit — 변경 감사 로그 조회(최신순·상한) + POST 저장 시 source 기록."""

    def test_audit_path_blocked_static(self):
        # audit.json 은 /data/db/ 하위 → 정적 노출 차단(API 로만).
        self.assertTrue(make_handler(path="/data/db/audit.json").is_blocked_static())

    def test_get_audit_returns_newest_first(self):
        with tempfile.TemporaryDirectory() as td:
            patches, current = _patch_storage(td, {"v": 1})
            for p in patches:
                p.start()
            try:
                storage.append_audit([{"field": "products·A", "before": None, "after": "x"}], "products", ts="2026-06-15T10:00:00")
                storage.append_audit([{"field": "products·B", "before": None, "after": "y"}], "machines", ts="2026-06-15T11:00:00")
                h, cap = make_get_handler("/api/audit")
                h.do_GET()
            finally:
                for p in patches:
                    p.stop()
            self.assertEqual(cap["status"], 200)
            self.assertEqual(len(cap["payload"]), 2)
            self.assertEqual(cap["payload"][0]["field"], "products·B")  # 최신순
            self.assertEqual(cap["payload"][1]["field"], "products·A")

    def test_get_audit_respects_limit(self):
        with tempfile.TemporaryDirectory() as td:
            patches, current = _patch_storage(td, {"v": 1})
            for p in patches:
                p.start()
            try:
                for i in range(5):
                    storage.append_audit([{"field": f"products·{i}", "before": None, "after": str(i)}], "web", ts=f"2026-06-15T10:0{i}:00")
                h, cap = make_get_handler("/api/audit?limit=2")
                h.do_GET()
            finally:
                for p in patches:
                    p.stop()
            self.assertEqual(len(cap["payload"]), 2)
            self.assertEqual(cap["payload"][0]["field"], "products·4")  # 가장 최신 2건

    def test_get_audit_empty_when_no_log(self):
        with tempfile.TemporaryDirectory() as td:
            patches, current = _patch_storage(td, {"v": 1})
            for p in patches:
                p.start()
            try:
                h, cap = make_get_handler("/api/audit")
                h.do_GET()
            finally:
                for p in patches:
                    p.stop()
            self.assertEqual(cap["status"], 200)
            self.assertEqual(cap["payload"], [])

    def test_post_db_records_audit_with_source(self):
        # POST /api/db 가 X-Edit-Source 를 감사 로그 source 로 기록한다.
        before = {"injection": {"3층": [{"machine": "10호기", "schedule": {"월": {"day": "", "night": ""}}}]}}
        after = {"injection": {"3층": [{"machine": "10호기", "schedule": {"월": {"day": "PIA블루", "night": ""}}}]}}
        with tempfile.TemporaryDirectory() as td:
            patches, current = _patch_storage(td, before)
            for p in patches:
                p.start()
            try:
                rev = storage.compute_rev(storage.read_json(current))
                body = json.dumps(after).encode("utf-8")
                h, cap = make_post_handler(
                    body,
                    headers={"X-Edit-Source": "injection", "If-Match": f'"{rev}"'},
                    path="/api/db")
                h.do_POST()
                self.assertEqual(cap["status"], 200)
                log = storage.read_audit()
                self.assertEqual(len(log), 1)
                self.assertEqual(log[0]["field"], "injection·3층·10호기·월·day")
                self.assertEqual(log[0]["after"], "PIA블루")
                self.assertEqual(log[0]["source"], "injection")
            finally:
                for p in patches:
                    p.stop()

    def test_post_db_defaults_source_to_web(self):
        before = {"products": [{"name": "A", "brand": "PIA", "inks": ["i1"]}]}
        after = {"products": [{"name": "A", "brand": "PIA", "inks": ["i1", "i2"]}]}
        with tempfile.TemporaryDirectory() as td:
            patches, current = _patch_storage(td, before)
            for p in patches:
                p.start()
            try:
                rev = storage.compute_rev(storage.read_json(current))
                body = json.dumps(after).encode("utf-8")
                # X-Edit-Source 없음 (If-Match 는 필수라 포함)
                h, cap = make_post_handler(body, headers={"If-Match": f'"{rev}"'}, path="/api/db")
                h.do_POST()
                log = storage.read_audit()
                self.assertEqual(len(log), 1)
                self.assertEqual(log[0]["source"], "web")
            finally:
                for p in patches:
                    p.stop()


if __name__ == "__main__":
    unittest.main()
