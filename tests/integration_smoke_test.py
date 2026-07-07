"""실 HTTP 통합 스모크 — 소켓 왕복으로 전 스택 검증(핸들러 스텁이 못 잡는 경로).

기존 server_test는 Handler를 __new__로 스텁 호출하므로 translate_path·실제 라우팅을
거치지 않는다. 이 테스트는 ThreadingHTTPServer를 임시 저장소로 격리 기동해:
  - 정적 우회 차단(//data, /data.) — 실제 파일 매핑 경로 기준
  - 주간 스냅샷 API 왕복(POST/list/read)
  - OCC(If-Match 필수 428 / stale 409 / 정상 200)
을 실 HTTP로 확인한다. 순수 표준 라이브러리라 CI(*_test.py 디스커버)에서 그대로 돈다.
"""
import http.client
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import server
import storage


class IntegrationSmokeTest(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        td = Path(self._td.name)
        db = td / "db"; db.mkdir()
        (td / "backups").mkdir()
        (td / "clean.json").write_text("{}", encoding="utf-8")
        (db / "current.json").write_text(json.dumps({"v": 1, "products": []}), encoding="utf-8")

        # 저장소 경로 격리(실데이터 보호) — 원복 위해 원본 보관.
        self._orig = {
            "DB_DIR": storage.DB_DIR, "BACKUP_DIR": storage.BACKUP_DIR,
            "SEED_FILE": storage.SEED_FILE, "CURRENT_FILE": storage.CURRENT_FILE,
            "AUDIT_FILE": storage.AUDIT_FILE, "ARCHIVE_DIR": storage.ARCHIVE_DIR,
        }
        storage.DB_DIR = db
        storage.BACKUP_DIR = td / "backups"
        storage.SEED_FILE = td / "clean.json"
        storage.CURRENT_FILE = db / "current.json"
        storage.AUDIT_FILE = db / "audit.json"
        storage.ARCHIVE_DIR = td / "archive"

        self._orig_hosts = server.ALLOWED_HOSTS
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        # 임의 포트 → 호스트 가드 허용 목록에 추가(가드 자체는 server_test가 검증).
        server.ALLOWED_HOSTS = tuple(server.ALLOWED_HOSTS) + (f"127.0.0.1:{self.port}",)
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self._thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        server.ALLOWED_HOSTS = self._orig_hosts
        for k, v in self._orig.items():
            setattr(storage, k, v)
        self._td.cleanup()

    def _req(self, method, path, body=None, headers=None):
        # http.client 로 raw path 전송 — urllib 의 // 정규화를 피해 우회 경로를 그대로 시험.
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        h = {"Host": f"127.0.0.1:{self.port}"}
        if headers:
            h.update(headers)
        data = json.dumps(body).encode("utf-8") if body is not None else None
        if data is not None:
            h["Content-Type"] = "application/json"
        conn.request(method, path, body=data, headers=h)
        resp = conn.getresponse()
        raw = resp.read()
        etag = (resp.getheader("ETag") or "").strip('"') or None
        conn.close()
        payload = None
        if raw:
            try:
                payload = json.loads(raw.decode("utf-8"))
            except ValueError:
                payload = None
        return resp.status, payload, etag

    # ── 정적 우회 차단 (실제 파일 매핑 경로 기준) ──────────────────────────────
    def test_static_double_slash_bypass_blocked(self):
        st, _, _ = self._req("GET", "//data/settings.json")
        self.assertEqual(st, 404)

    def test_static_trailing_dot_bypass_blocked(self):
        st, _, _ = self._req("GET", "/data./db/current.json")
        self.assertEqual(st, 404)

    def test_normal_static_served(self):
        # 실제 존재하는 정적 파일은 계속 서빙(차단이 과하지 않은지 양성 대조).
        st, _, _ = self._req("GET", "/index.html")
        self.assertEqual(st, 200)

    # ── 주간 스냅샷 API 왕복 ──────────────────────────────────────────────────
    def test_snapshot_roundtrip(self):
        st, payload, _ = self._req("POST", "/api/snapshot",
                                   body={"week": "2026-W28", "data": {"products": [{"id": "p_1"}]}})
        self.assertEqual(st, 200)
        self.assertEqual(payload["week"], "2026-W28")

        st, payload, _ = self._req("GET", "/api/snapshots")
        self.assertEqual(st, 200)
        self.assertEqual([e["week"] for e in payload], ["2026-W28"])

        st, payload, _ = self._req("GET", "/api/snapshot?week=2026-W28")
        self.assertEqual(st, 200)
        self.assertEqual(payload["products"][0]["id"], "p_1")

        st, _, _ = self._req("GET", "/api/snapshot?week=2099-W01")
        self.assertEqual(st, 404)

    # ── OCC (If-Match 필수·stale·정상) ────────────────────────────────────────
    def test_occ_over_http(self):
        st, _, rev = self._req("GET", "/api/db")
        self.assertEqual(st, 200)
        self.assertIsNotNone(rev)

        # If-Match 없음 → 428
        st, _, _ = self._req("POST", "/api/db", body={"v": 2})
        self.assertEqual(st, 428)

        # stale → 409
        st, _, _ = self._req("POST", "/api/db", body={"v": 2}, headers={"If-Match": '"deadbeef00000000"'})
        self.assertEqual(st, 409)

        # 정상 → 200
        st, payload, new_rev = self._req("POST", "/api/db", body={"v": 2}, headers={"If-Match": f'"{rev}"'})
        self.assertEqual(st, 200)
        self.assertTrue(payload.get("ok"))
        self.assertTrue(new_rev and new_rev != rev)

    def test_external_host_forbidden_over_http(self):
        # Host 가 허용 목록 밖이면 /api/* 거부(DNS rebinding 방어) — 실 HTTP 경로.
        st, _, _ = self._req("GET", "/api/db", headers={"Host": "evil.com"})
        self.assertEqual(st, 403)


if __name__ == "__main__":
    unittest.main()
