import json
from pathlib import Path

from storage import DATA_DIR, write_json_atomic


SETTINGS_FILE = DATA_DIR / "settings.json"
DEFAULT_MODEL = "gemini-3.1-flash-lite"
KEY_TARGET = "InkPlanGeminiApiKey"


def _read_file_settings():
    if not SETTINGS_FILE.exists():
        return {}
    with SETTINGS_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_file_settings(data):
    write_json_atomic(SETTINGS_FILE, data)


def read_api_key():
    return _read_file_settings().get("apiKey", "")


def write_api_key(value):
    value = (value or "").strip()
    data = _read_file_settings()
    if value:
        data["apiKey"] = value
    else:
        data.pop("apiKey", None)
    _write_file_settings(data)


def read_settings():
    data = _read_file_settings()
    return {
        "apiKey": read_api_key(),
        "model": data.get("model") or DEFAULT_MODEL,
    }


def write_settings(data):
    model = (data.get("model") or DEFAULT_MODEL).strip()
    api_key = (data.get("apiKey") or "").strip()
    write_api_key(api_key)
    file_data = _read_file_settings()
    file_data["model"] = model
    if api_key:
        file_data["apiKey"] = api_key
    else:
        file_data.pop("apiKey", None)
    _write_file_settings(file_data)
    return read_settings()
