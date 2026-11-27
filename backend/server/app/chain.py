"""컨트랙트 읽기 (eth_call). ABI로 함수 선택자를 만들고 인자·결과를 인코딩/디코딩한다."""

import httpx
from eth_abi import decode, encode
from eth_utils import keccak

from .config import chainbuy_abi, chainbuy_address, settings


def id_hash(s: str) -> str:
    """판매자·상품·쇼핑몰 id → 컨트랙트에 쓰는 bytes32 (keccak256)"""
    return "0x" + keccak(text=s).hex()


def _type_str(p: dict) -> str:
    """ABI 항목 → 정규 타입 문자열. tuple은 (t1,t2,...)"""
    if p["type"].startswith("tuple"):
        inner = ",".join(_type_str(c) for c in p["components"])
        return f"({inner}){p['type'][len('tuple'):]}"
    return p["type"]


def _fn(name: str) -> dict:
    for f in chainbuy_abi():
        if f.get("type") == "function" and f["name"] == name:
            return f
    raise KeyError(name)


def _hexify(v):
    if isinstance(v, bytes):
        return "0x" + v.hex()
    return v


def call(name: str, *args):
    f = _fn(name)
    in_types = [_type_str(p) for p in f["inputs"]]
    selector = keccak(text=f"{name}({','.join(in_types)})")[:4]
    data = "0x" + (selector + encode(in_types, list(args))).hex()
    res = httpx.post(
        settings().rpc_url,
        json={"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": chainbuy_address(), "data": data}, "latest"]},
        timeout=10,
    ).json()
    if "error" in res:
        raise RuntimeError(res["error"].get("message", "eth_call 실패"))
    out_types = [_type_str(p) for p in f["outputs"]]
    return decode(out_types, bytes.fromhex(res["result"][2:])), f["outputs"]


REVIEWER_ROLE = "0x" + keccak(text="REVIEWER_ROLE").hex()
SELLER_MANAGER_ROLE = "0x" + keccak(text="SELLER_MANAGER_ROLE").hex()


def _has_role(role: str, address: str) -> bool:
    try:
        (ok,), _ = call("hasRole", bytes.fromhex(role[2:]), address)
        return bool(ok)
    except Exception:
        return False


def is_reviewer(address: str) -> bool:
    """공구 담당자 권한은 서버가 따로 두지 않고 컨트랙트 REVIEWER_ROLE을 따른다"""
    return _has_role(REVIEWER_ROLE, address)


def is_seller_manager(address: str) -> bool:
    """입점 담당자(판매자 등록) 권한. 컨트랙트가 공구 담당자와 겸직을 막는다"""
    return _has_role(SELLER_MANAGER_ROLE, address)


def onchain_seller(seller_id: str) -> dict:
    (wallet, active), _ = call("sellers", bytes.fromhex(id_hash(seller_id)[2:]))
    return {"wallet": wallet, "active": active}


def onchain_group(group_id: int) -> dict | None:
    try:
        (g,), outputs = call("getGroup", group_id)
    except Exception:
        return None
    names = [c["name"] for c in outputs[0]["components"]]
    return {n: _hexify(v) for n, v in zip(names, g)}


def group_count() -> int:
    (n,), _ = call("groupCount")
    return int(n)


def participant(group_id: int, user: str) -> dict:
    (p,), outputs = call("getParticipant", group_id, user)
    names = [c["name"] for c in outputs[0]["components"]]
    return {n: _hexify(v) for n, v in zip(names, p)}
