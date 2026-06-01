"""server.py 보안 가드 단위 테스트.

Handler 의 가드 메서드(is_api_request_allowed / is_blocked_static)는
self.headers 와 self.path 만 읽으므로, 소켓 바인딩(__init__)을 우회한
Handler.__new__(Handler) 인스턴스에 헤더/경로만 주입해 단위 검증한다.
"""
import unittest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import server


def make_handler(headers=None, path="/"):
    h = server.Handler.__new__(server.Handler)
    h.headers = headers or {}
    h.path = path
    return h


class ApiGuardTest(unittest.TestCase):
    """is_api_request_allowed — DNS rebinding(Host) / CSRF(Origin) 방어."""

    def test_local_host_without_origin_allowed(self):
        self.assertTrue(make_handler({"Host": "127.0.0.1:8765"}).is_api_request_allowed())

    def test_localhost_host_allowed(self):
        self.assertTrue(make_handler({"Host": "localhost"}).is_api_request_allowed())

    def test_external_host_blocked(self):
        # DNS rebinding: 공격자 도메인이 127.0.0.1로 리바인딩돼도 Host 는 공격자 도메인
        self.assertFalse(make_handler({"Host": "evil.com"}).is_api_request_allowed())

    def test_empty_host_allowed(self):
        # Host 헤더 부재(빈 문자열)는 통과 — 기존 동작 명문화 (host falsy → 검사 skip)
        self.assertTrue(make_handler({}).is_api_request_allowed())

    def test_same_origin_allowed(self):
        h = make_handler({"Host": "127.0.0.1:8765", "Origin": "http://127.0.0.1:8765"})
        self.assertTrue(h.is_api_request_allowed())

    def test_localhost_origin_allowed(self):
        h = make_handler({"Host": "localhost:8765", "Origin": "http://localhost:8765"})
        self.assertTrue(h.is_api_request_allowed())

    def test_cross_site_origin_blocked(self):
        # CSRF: 외부 사이트의 fetch — Origin netloc 이 로컬과 불일치
        h = make_handler({"Host": "127.0.0.1:8765", "Origin": "http://evil.com"})
        self.assertFalse(h.is_api_request_allowed())

    def test_cross_site_origin_with_port_blocked(self):
        h = make_handler({"Host": "127.0.0.1:8765", "Origin": "http://evil.com:8765"})
        self.assertFalse(h.is_api_request_allowed())


class BlockedStaticTest(unittest.TestCase):
    """is_blocked_static — 런타임 데이터(키/DB/백업) 정적 노출 차단."""

    def test_db_path_blocked(self):
        self.assertTrue(make_handler(path="/data/db/current.json").is_blocked_static())

    def test_backups_path_blocked(self):
        self.assertTrue(make_handler(path="/data/backups/2026.json").is_blocked_static())

    def test_settings_path_blocked(self):
        self.assertTrue(make_handler(path="/data/settings.json").is_blocked_static())

    def test_normal_asset_allowed(self):
        self.assertFalse(make_handler(path="/index.html").is_blocked_static())
        self.assertFalse(make_handler(path="/app.jsx").is_blocked_static())

    def test_uppercase_bypass_blocked(self):
        # 대소문자 우회 차단 (경로 소문자화)
        self.assertTrue(make_handler(path="/DATA/DB/current.json").is_blocked_static())

    def test_percent_encoded_bypass_blocked(self):
        # 퍼센트 인코딩 우회 차단 (unquote 후 비교)
        self.assertTrue(make_handler(path="/data%2Fdb/current.json").is_blocked_static())


if __name__ == "__main__":
    unittest.main()
