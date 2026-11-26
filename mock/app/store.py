"""mock 서비스 상태 저장: 메모리 + JSON 파일 (서버를 재시작해도 데모 상태 유지)"""

import json
import threading

from .config import MOCK_DIR

_PATH = MOCK_DIR / "data.json"
_lock = threading.Lock()
_data: dict = {"products": {}, "orders": {}, "cards": {}, "shipments": {}}

if _PATH.exists():
    try:
        _data.update(json.loads(_PATH.read_text()))
    except ValueError:
        pass


def table(name: str) -> dict:
    return _data[name]


def save() -> None:
    with _lock:
        _PATH.write_text(json.dumps(_data, ensure_ascii=False, indent=1))
