"""체인 읽기·쓰기 최소 도구 (JSON-RPC + eth_account 서명). 카드 발급사가 잔액을 컨트랙트로 돌려줄 때 쓴다."""

import json
import time
from functools import lru_cache
from pathlib import Path

import httpx
from eth_abi import decode, encode
from eth_account import Account
from eth_utils import keccak

from .config import ROOT, settings


def rpc(method: str, params: list):
    res = httpx.post(settings().rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=20).json()
    if "error" in res:
        raise RuntimeError(res["error"].get("message", str(res["error"])))
    return res["result"]


@lru_cache
def deployment() -> dict:
    s = settings()
    if s.chainbuy_address and s.token_address:
        return {"ChainBuy": s.chainbuy_address, "ChainBuyUSD": s.token_address}
    return json.loads((ROOT / "blockchain" / "deployments" / "localhost.json").read_text())


@lru_cache
def chainbuy_abi() -> list[dict]:
    path = ROOT / "blockchain" / "artifacts" / "contracts" / "ChainBuy.sol" / "ChainBuy.json"
    if path.exists():
        return json.loads(path.read_text())["abi"]
    return json.loads((Path(__file__).parent / "abi" / "ChainBuy.json").read_text())["abi"]


def _type_str(p: dict) -> str:
    if p["type"].startswith("tuple"):
        return "(" + ",".join(_type_str(c) for c in p["components"]) + ")" + p["type"][len("tuple"):]
    return p["type"]


def _fn(abi: list[dict], name: str) -> dict:
    return next(f for f in abi if f.get("type") == "function" and f["name"] == name)


def calldata(sig_name: str, types: list[str], args: list) -> str:
    return "0x" + (keccak(text=f"{sig_name}({','.join(types)})")[:4] + encode(types, args)).hex()


def call(to: str, sig_name: str, in_types: list[str], args: list, out_types: list[str]):
    out = rpc("eth_call", [{"to": to, "data": calldata(sig_name, in_types, args)}, "latest"])
    return decode(out_types, bytes.fromhex(out[2:]))


def get_group(group_id: int) -> dict:
    f = _fn(chainbuy_abi(), "getGroup")
    out_types = [_type_str(p) for p in f["outputs"]]
    (g,) = decode(out_types, bytes.fromhex(rpc("eth_call", [{"to": deployment()["ChainBuy"], "data": calldata("getGroup", ["uint256"], [group_id])}, "latest"])[2:]))
    names = [c["name"] for c in f["outputs"][0]["components"]]
    return {n: ("0x" + v.hex() if isinstance(v, bytes) else v) for n, v in zip(names, g)}


def send(key: str, to: str, data: str) -> dict:
    """트랜잭션 서명·전송 후 영수증까지 기다린다"""
    acct = Account.from_key(key)
    tx = {
        "to": to,
        "data": data,
        "value": 0,
        "nonce": int(rpc("eth_getTransactionCount", [acct.address, "pending"]), 16),
        "chainId": int(rpc("eth_chainId", []), 16),
        "gasPrice": int(rpc("eth_gasPrice", []), 16),
    }
    tx["gas"] = int(int(rpc("eth_estimateGas", [{"from": acct.address, "to": to, "data": data}]), 16) * 1.2)
    signed = acct.sign_transaction(tx)
    h = rpc("eth_sendRawTransaction", ["0x" + signed.raw_transaction.hex().removeprefix("0x")])
    for _ in range(120):
        r = rpc("eth_getTransactionReceipt", [h])
        if r:
            if int(r["status"], 16) != 1:
                raise RuntimeError(f"트랜잭션 실패: {h}")
            return r
        time.sleep(1)
    raise RuntimeError(f"영수증 대기 시간 초과: {h}")
