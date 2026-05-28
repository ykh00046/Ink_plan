from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import socket
import threading
import webbrowser
from urllib.parse import parse_qs, unquote, urlparse

from storage import (
    ASSET_ROOT,
    read_current,
    write_current,
    create_backup,
    list_backups,
    read_backup,
    restore_backup,
    prune_backups,
)
from settings_store import read_settings, write_settings


PORT = 8765
URL = f"http://127.0.0.1:{PORT}/"

# 런타임 데이터(API 키/DB/백업)는 정적 파일로 노출 금지 — /api/* 로만 접근
BLOCKED_STATIC_PREFIXES = ("/data/db", "/data/backups", "/data/settings")
# 요청 본문 상한 (DB 저장용) — 메모리 보호
MAX_BODY_BYTES = 64 * 1024 * 1024
# /api/* 는 로컬 동일 출처에서만 허용 — DNS rebinding(키 유출) / CSRF(데이터 덮어쓰기) 차단
ALLOWED_HOSTS = ("127.0.0.1:8765", "localhost:8765", "127.0.0.1", "localhost")


def port_is_open():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", PORT)) == 0


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ASSET_ROOT), **kwargs)

    def log_message(self, format, *args):
        return

    def end_headers(self):
        # 정적 소스 파일(.jsx/.js/.css/.html)은 캐시 금지 — 항상 최신 코드 로드
        path = (self.path or "").split("?")[0]
        if path.endswith((".jsx", ".js", ".css", ".html")) or path in ("/", ""):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def is_api_request_allowed(self):
        # Host 헤더가 로컬이 아니면 거부 (DNS rebinding 방어 — 공격자 도메인이 127.0.0.1로
        # 리바인딩돼도 Host 는 공격자 도메인이라 차단됨).
        host = (self.headers.get("Host") or "").strip().lower()
        if host and host not in ALLOWED_HOSTS:
            return False
        # Origin 이 있으면(=다른 사이트의 fetch 등) 로컬 출처와 일치해야 함 (CSRF 방어).
        origin = self.headers.get("Origin")
        if origin:
            if urlparse(origin).netloc.lower() not in ALLOWED_HOSTS:
                return False
        return True

    def is_blocked_static(self):
        # 런타임 데이터(키/DB/백업)는 정적 파일로 노출 금지.
        # 퍼센트 인코딩 해제 + 소문자화로 인코딩·대소문자 우회 차단.
        decoded = unquote(urlparse(self.path).path).lower()
        return decoded.startswith(BLOCKED_STATIC_PREFIXES)

    def read_body_json(self):
        # Content-Length 헤더를 신뢰하지 않고 실제 읽은 바이트로 상한 검증.
        # (헤더가 본문보다 작거나 위조된 경우 방어). 한 바이트 더 읽어 초과 판정.
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_BODY_BYTES:
            raise ValueError(f"request body too large ({length} bytes)")
        raw = self.rfile.read(min(length, MAX_BODY_BYTES + 1))
        if len(raw) > MAX_BODY_BYTES:
            raise ValueError("request body too large")
        text = raw.decode("utf-8")
        return json.loads(text) if text else None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/") and not self.is_api_request_allowed():
            self.send_json({"error": "forbidden"}, 403)
            return
        if path == "/api/db":
            self.send_json(read_current())
            return
        if path == "/api/backups":
            self.send_json([
                {"name": p.name, "size": p.stat().st_size, "mtime": p.stat().st_mtime}
                for p in list_backups()
            ])
            return
        if path == "/api/backup":
            name = (parse_qs(parsed.query).get("name") or [""])[0]
            if not name:
                self.send_json({"error": "name required"}, 400)
                return
            try:
                self.send_json(read_backup(name))
            except FileNotFoundError:
                self.send_json({"error": "backup not found"}, 404)
            return
        if path == "/api/settings":
            self.send_json(read_settings())
            return
        # 런타임 데이터 디렉터리는 정적 파일로 직접 서빙하지 않음
        if self.is_blocked_static():
            self.send_json({"error": "not found"}, 404)
            return
        return super().do_GET()

    def do_HEAD(self):
        # HEAD 로도 차단 디렉터리의 파일 존재/크기가 노출되지 않도록 동일 차단
        if self.is_blocked_static():
            self.send_json({"error": "not found"}, 404)
            return
        return super().do_HEAD()

    def do_POST(self):
        if not self.is_api_request_allowed():
            self.send_json({"error": "forbidden"}, 403)
            return
        try:
            if self.path == "/api/db":
                data = self.read_body_json()
                if not isinstance(data, dict):
                    self.send_json({"error": "invalid json"}, 400)
                    return
                write_current(data)
                self.send_json({"ok": True})
                return
            if self.path == "/api/backup":
                target = create_backup("manual")
                prune_backups()
                self.send_json({"ok": True, "name": target.name})
                return
            if self.path == "/api/restore":
                data = self.read_body_json() or {}
                restored = restore_backup(data.get("name", ""))
                self.send_json({"ok": True, "name": restored.name})
                return
            if self.path == "/api/settings":
                data = self.read_body_json() or {}
                self.send_json(write_settings(data))
                return
        except Exception as e:
            self.send_json({"error": str(e)}, 500)
            return
        self.send_json({"error": "not found"}, 404)


def open_app():
    webbrowser.open(URL)


def create_server():
    create_backup("startup")
    prune_backups()
    return ThreadingHTTPServer(("127.0.0.1", PORT), Handler)


def run_forever(open_browser=True):
    httpd = create_server()
    if open_browser:
        threading.Timer(0.5, open_app).start()
    httpd.serve_forever()
    return httpd


def run_in_thread(open_browser=True):
    httpd = create_server()
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    if open_browser:
        threading.Timer(0.5, open_app).start()
    return httpd, thread


def main():
    if port_is_open():
        open_app()
        return
    run_forever(open_browser=True)


if __name__ == "__main__":
    main()
