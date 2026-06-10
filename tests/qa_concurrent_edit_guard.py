"""실서버 통합 QA — 다중 탭 동시편집 가드(ETag/If-Match/409).

임시 디렉터리로 storage 경로를 격리해 실데이터를 건드리지 않고, 실제
ThreadingHTTPServer + urllib HTTP 왕복으로 OCC 동작을 검증한다.
(Zero Script QA: 비파괴 경로, 서버 스레드 기동 후 시나리오 검증)
"""
import json
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import server
import storage

PASS, FAIL = 0, 0


def check(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}")


def req(base, method="GET", body=None, if_match=None):
    url = f"{base}/api/db"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        r.add_header("Content-Type", "application/json")
    if if_match is not None:
        r.add_header("If-Match", f'"{if_match}"')
    try:
        with urllib.request.urlopen(r) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            etag = (resp.headers.get("ETag") or "").strip('"') or None
            return resp.status, payload, etag
    except urllib.error.HTTPError as e:
        payload = json.loads(e.read().decode("utf-8"))
        etag = (e.headers.get("ETag") or "").strip('"') or None
        return e.code, payload, etag


def main():
    with tempfile.TemporaryDirectory() as td:
        db = Path(td) / "db"
        backups = Path(td) / "backups"
        seed = Path(td) / "clean.json"
        db.mkdir(); backups.mkdir()
        seed.write_text("{}", encoding="utf-8")
        current = db / "current.json"
        current.write_text(json.dumps({"v": 1}), encoding="utf-8")

        storage.DB_DIR = db
        storage.BACKUP_DIR = backups
        storage.SEED_FILE = seed
        storage.CURRENT_FILE = current

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        port = httpd.server_address[1]
        base = f"http://127.0.0.1:{port}"
        # 임의 포트로 기동하므로 호스트 가드 허용 목록에 현재 포트를 추가(가드 자체는 server_test 검증).
        server.ALLOWED_HOSTS = tuple(server.ALLOWED_HOSTS) + (f"127.0.0.1:{port}",)
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        try:
            # 1) GET → 200 + ETag
            st, payload, rev1 = req(base, "GET")
            check("GET /api/db 200", st == 200)
            check("GET ETag 노출", rev1 is not None)
            check("GET 내용 v=1", payload.get("v") == 1)

            # 2) POST If-Match=rev1 → 200, 새 rev
            st, payload, rev2 = req(base, "POST", {"v": 2}, if_match=rev1)
            check("POST If-Match 일치 → 200", st == 200)
            check("POST 응답 ok+rev", payload.get("ok") is True and "rev" in payload)
            check("POST 새 rev 갱신", rev2 and rev2 != rev1)

            # 3) POST If-Match=rev1 (stale) → 409
            st, payload, cur = req(base, "POST", {"v": 3}, if_match=rev1)
            check("POST stale If-Match → 409", st == 409)
            check("409 error=conflict", payload.get("error") == "conflict")
            check("409 현재 rev 동반", payload.get("rev") == rev2)

            # 4) 409 후에도 파일 보존(v=2)
            st, payload, _ = req(base, "GET")
            check("충돌 후 파일 보존 v=2", payload.get("v") == 2)

            # 5) POST If-Match=rev2 → 200
            st, payload, rev3 = req(base, "POST", {"v": 3}, if_match=rev2)
            check("최신 rev 로 재시도 → 200", st == 200)

            # 6) POST If-Match 없음 → 200(폴백 호환)
            st, payload, _ = req(base, "POST", {"v": 4})
            check("If-Match 없음 → 200(폴백)", st == 200)
            st, payload, _ = req(base, "GET")
            check("무조건 기록 반영 v=4", payload.get("v") == 4)
        finally:
            httpd.shutdown()

    print(f"\n결과: {PASS} PASS / {FAIL} FAIL")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
