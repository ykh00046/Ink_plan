from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import re
import socket
import threading
import traceback
import webbrowser
from urllib.parse import parse_qs, urlparse

from storage import (
    ASSET_ROOT,
    read_current,
    read_seed,
    write_current,
    write_current_checked,
    compute_rev,
    ConflictError,
    create_backup,
    list_backups,
    read_backup,
    restore_backup,
    prune_backups,
    read_audit,
    write_week_snapshot,
    list_week_snapshots,
    read_week_snapshot,
    write_week_summary,
    read_week_summaries,
)
from settings_store import read_settings, write_settings


# 8766: C:\X\Flow(uvicorn)가 8765를 사용하므로 충돌 회피를 위해 영구 변경 (2026-06-10)
PORT = 8766
URL = f"http://127.0.0.1:{PORT}/"

# 바인딩 주소 — 기본은 로컬 전용(지금까지와 동일, 안전). 사내망 서버 PC에서만
# 환경변수 INK_PLAN_BIND=0.0.0.0 으로 켜서 다른 PC의 브라우저 접속을 허용한다.
# 기본값이 로컬이라 이 변경은 명시적으로 켜지 않는 한 보안을 낮추지 않는다.
BIND_HOST = (os.environ.get("INK_PLAN_BIND") or "127.0.0.1").strip() or "127.0.0.1"
LAN_MODE = BIND_HOST not in ("127.0.0.1", "localhost")
# 사설 LAN 대역(RFC1918) — LAN 모드에서만 Host/Origin 허용에 사용. 공인 도메인/IP는 계속 거부
# → DNS rebinding(공격자 도메인) 방어는 LAN 모드에서도 유지된다.
_PRIVATE_IP_RE = re.compile(
    r"^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|192\.168\.\d{1,3}\.\d{1,3}"
    r"|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$"
)

# 런타임 데이터(API 키/DB/백업/시드)는 정적 파일로 노출 금지 — /api/* 로만 접근.
# deny-by-default: data/ 트리 전체 차단. 시드(clean.json)도 /api/seed 로만 제공.
# 차단 판정은 translate_path() 결과(실제 열리는 파일 경로) 기준 — is_blocked_static 참고.
BLOCKED_DATA_DIRNAME = "data"
# 요청 본문 상한 (DB 저장용) — 메모리 보호
MAX_BODY_BYTES = 64 * 1024 * 1024
# /api/* 는 로컬 동일 출처에서만 허용 — DNS rebinding(키 유출) / CSRF(데이터 덮어쓰기) 차단
ALLOWED_HOSTS = (f"127.0.0.1:{PORT}", f"localhost:{PORT}", "127.0.0.1", "localhost")


def _host_allowed(host):
    # 허용 Host/Origin 판정 단일 출처. 로컬은 항상 허용, LAN 모드에선 사설 IP:PORT 도 허용,
    # 공인 도메인/IP·포트 불일치는 거부(rebinding/CSRF 방어 유지).
    host = (host or "").strip().lower()
    if not host:
        return False
    if host in ALLOWED_HOSTS:
        return True
    if LAN_MODE:
        hostname, _, port = host.partition(":")
        if (port or str(PORT)) == str(PORT) and _PRIVATE_IP_RE.match(hostname):
            return True
    return False


def local_lan_ip():
    # 이 PC의 LAN IP(다른 PC가 접속할 주소) 조회 — 실패 시 None.
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        return None


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

    def send_json(self, data, status=200, headers=None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        if headers:
            for key, value in headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _if_match_rev(self):
        # If-Match 헤더(따옴표 포함 ETag)에서 base 리비전 추출. 없으면 None.
        # /api/db 쓰기는 If-Match 필수(428) — 없으면 OCC(lost-update 가드)가 통째로 우회된다.
        raw = self.headers.get("If-Match")
        return raw.strip().strip('"') if raw else None

    def is_api_request_allowed(self):
        # Host 헤더가 허용 대상이 아니면 거부 (DNS rebinding 방어 — 공격자 도메인이
        # 로컬/사설IP로 리바인딩돼도 Host 는 공격자 도메인이라 차단됨).
        # 빈/누락 Host 도 거부(비브라우저 클라이언트 방어). LAN 모드면 사설 IP Host 도 허용.
        if not _host_allowed(self.headers.get("Host")):
            return False
        # Origin 이 있으면(=다른 사이트의 fetch 등) 허용 출처와 일치해야 함 (CSRF 방어).
        origin = self.headers.get("Origin")
        if origin:
            if not _host_allowed(urlparse(origin).netloc):
                return False
        return True

    def is_blocked_static(self):
        # data/ 트리는 전면 차단(deny-by-default) — 시드 포함 전부 /api/* 로만.
        # 차단 판정은 실제 파일을 여는 translate_path() 결과(해석된 절대 경로)로 수행.
        # URL 문자열 프리픽스 검사만으로는 //data/...(urlparse가 data를 netloc으로 흡수),
        # /data./...(Windows가 후행 점을 제거하고 열어줌) 같은 파싱 불일치 우회가 가능했다.
        try:
            target = Path(self.translate_path(self.path)).resolve()
            root = Path(ASSET_ROOT).resolve()
            rel = target.relative_to(root)
        except ValueError:
            return True   # 프로젝트 루트 밖으로 해석되는 경로 → 차단
        except Exception:
            return True   # 해석 불가/비정상 경로 → 차단 (deny-by-default)
        # Windows 후행 점·공백 제거 의미론 반영: 구성요소 정규화 후 data 트리 판정
        parts = [p.rstrip(". ").lower() for p in rel.parts]
        return bool(parts) and parts[0] == BLOCKED_DATA_DIRNAME

    def read_body_json(self):
        # chunked 본문은 stdlib 핸들러가 디코드하지 않아 0바이트로 오인됨 → 명시 거부.
        if (self.headers.get("Transfer-Encoding") or "").lower() == "chunked":
            raise ValueError("chunked transfer-encoding not supported")
        # Content-Length 헤더를 신뢰하지 않고 실제 읽은 바이트로 상한 검증.
        # (헤더가 본문보다 작거나 위조된 경우 방어). 한 바이트 더 읽어 초과 판정.
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except (TypeError, ValueError):
            raise ValueError("invalid Content-Length")
        if length < 0:
            raise ValueError("invalid Content-Length")
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
            # current.json 파싱 실패(손상/torn write)를 구조화된 502로 — 미처리 예외는
            # 연결 끊김/불투명 500이 되어 프론트가 폴백(/api/seed)조차 못 탄다.
            try:
                data = read_current()
            except (ValueError, OSError):
                self.send_json({"error": "db read failed"}, 502)
                return
            # ETag = 현재 내용 리비전 — 클라이언트가 이후 저장 시 If-Match 로 되돌려 OCC 성립.
            self.send_json(data, headers={"ETag": f'"{compute_rev(data)}"'})
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
        if path == "/api/audit":
            # 변경 감사 로그 — 최신순 + 상한(기본 500, 최대 2000). audit.json 자체는
            # /data/ 정적 차단 트리에 있어 이 API 로만 노출된다.
            try:
                limit = int((parse_qs(parsed.query).get("limit") or ["500"])[0])
            except (TypeError, ValueError):
                limit = 500
            limit = max(1, min(limit, 2000))
            entries = read_audit()
            self.send_json(list(reversed(entries))[:limit])
            return
        if path == "/api/snapshots":
            # 주간 마감 스냅샷 목록(최신순) — History 조회 진입점.
            self.send_json(list_week_snapshots())
            return
        if path == "/api/snapshot-summaries":
            # 주별 잉크 소비 요약 인덱스 — 소비 추세용(전체 스냅샷 재독 없이).
            self.send_json(read_week_summaries())
            return
        if path == "/api/snapshot":
            week = (parse_qs(parsed.query).get("week") or [""])[0]
            try:
                self.send_json(read_week_snapshot(week))
            except ValueError:
                self.send_json({"error": "bad week"}, 400)
            except FileNotFoundError:
                self.send_json({"error": "snapshot not found"}, 404)
            return
        if path == "/api/settings":
            self.send_json(read_settings())
            return
        if path == "/api/seed":
            # 시드 스냅샷(clean.json) — /api/db 실패 시 프론트 폴백용. 정적 노출 대체.
            try:
                self.send_json(read_seed())
            except FileNotFoundError:
                self.send_json({"error": "seed not found"}, 404)
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
                # If-Match 기준 리비전과 현재 rev 가 일치할 때만 기록(OCC).
                # If-Match 부재는 428 거부 — 무조건 기록을 허용하면 stale 탭이 다른
                # 사용자의 최신 편집을 409 없이 통째로 덮어쓴다(lost-update).
                base_rev = self._if_match_rev()
                if base_rev is None:
                    self.send_json({"error": "precondition required"}, 428)
                    return
                # X-Edit-Source: 편집 화면 식별자 — 감사 로그 source. 누락 시 'web'.
                source = self.headers.get("X-Edit-Source") or "web"
                new_rev = write_current_checked(data, base_rev, source=source)
                self.send_json({"ok": True, "rev": new_rev},
                               headers={"ETag": f'"{new_rev}"'})
                return
            if self.path == "/api/backup":
                target = create_backup("manual")
                prune_backups()
                self.send_json({"ok": True, "name": target.name})
                return
            if self.path == "/api/snapshot":
                # 주간 마감 스냅샷 적재 — body {week, data?}. data 없으면 현재 DB.
                body = self.read_body_json() or {}
                week = body.get("week")
                try:
                    label, _ = write_week_snapshot(week, body.get("data"))
                    # 소비 요약이 함께 오면 인덱스에 적재(추세용). 없으면 스냅샷만.
                    summary = body.get("summary")
                    if isinstance(summary, dict):
                        write_week_summary(label, summary)
                except ValueError:
                    self.send_json({"error": "bad week"}, 400)
                    return
                self.send_json({"ok": True, "week": label})
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
        except ConflictError as exc:
            # 다른 탭/창이 먼저 저장 → lost-update 차단. 현재 rev 를 함께 돌려 클라가 정합화.
            self.send_json({"error": "conflict", "rev": exc.current_rev}, 409,
                           headers={"ETag": f'"{exc.current_rev}"'})
            return
        except ValueError:
            # JSONDecodeError·UnicodeDecodeError 는 ValueError 하위 → 본문 파싱/검증 오류
            self.send_json({"error": "bad request"}, 400)
            return
        except FileNotFoundError:
            self.send_json({"error": "not found"}, 404)
            return
        except Exception:
            traceback.print_exc()  # 상세는 서버 로그에만, 응답엔 일반 메시지
            self.send_json({"error": "internal error"}, 500)
            return
        self.send_json({"error": "not found"}, 404)


def open_app():
    webbrowser.open(URL)


def create_server():
    create_backup("startup")
    prune_backups()
    return ThreadingHTTPServer((BIND_HOST, PORT), Handler)


def print_startup_banner():
    # LAN 모드면 다른 PC가 접속할 주소를 콘솔에 안내(bat 창에서 바로 확인).
    if LAN_MODE:
        ip = local_lan_ip() or "<이 PC IP>"
        print("=" * 52, flush=True)
        print(f"  [LAN 모드] 다른 PC 브라우저에서 접속:", flush=True)
        print(f"    http://{ip}:{PORT}/", flush=True)
        print(f"  (bind {BIND_HOST} · 방화벽에서 {PORT} 인바운드 허용 필요)", flush=True)
        print("=" * 52, flush=True)
    else:
        print(f"서버 시작: {URL} (로컬 전용)", flush=True)


def run_forever(open_browser=True):
    httpd = create_server()
    print_startup_banner()
    if open_browser:
        threading.Timer(0.5, open_app).start()
    # Ctrl+C(KeyboardInterrupt)는 정상 종료 — traceback 대신 안내만 찍고 소켓 정리.
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.", flush=True)
    finally:
        httpd.server_close()
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
        # 이미 실행 중 — 로컬 모드면 브라우저만 다시 열고, LAN(서버) 모드면 조용히 종료.
        if not LAN_MODE:
            open_app()
        return
    # LAN(서버) 모드에선 서버 PC에 브라우저를 띄우지 않는다(헤드리스 운영).
    run_forever(open_browser=not LAN_MODE)


if __name__ == "__main__":
    main()
