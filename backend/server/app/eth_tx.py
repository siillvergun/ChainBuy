"""체인 쓰기 (트랜잭션 서명·전송)와 이벤트 조회. 에이전트가 쓴다."""

import time

import httpx
from eth_abi import decode, encode
from eth_account import Account
from eth_utils import keccak

from .config import chainbuy_address, settings


def rpc(method: str, params: list):
    res = httpx.post(settings().rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=20).json()
    if "error" in res:
        raise RuntimeError(res["error"].get("message", str(res["error"])))
    return res["result"]


def calldata(name: str, types: list[str], args: list) -> str:
    return "0x" + (keccak(text=f"{name}({','.join(types)})")[:4] + encode(types, args)).hex()


def send(key: str, data: str, to: str | None = None) -> str:
    """트랜잭션을 서명해 보내고 영수증까지 기다린 뒤 tx 해시를 돌려준다"""
    to = to or chainbuy_address()
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
    for _ in range(180):
        r = rpc("eth_getTransactionReceipt", [h])
        if r:
            if int(r["status"], 16) != 1:
                raise RuntimeError(f"트랜잭션 실패: {h}")
            return h
        time.sleep(1)
    raise RuntimeError(f"영수증 대기 시간 초과: {h}")


DEPOSITED_TOPIC = "0x" + keccak(text="Deposited(uint256,address,uint32,uint256)").hex()


def participants(group_id: int) -> list[str]:
    """Deposited 이벤트로 이 공구에 참여한 지갑 목록 (참여 취소한 사람도 포함될 수 있어 qty로 다시 확인)"""
    logs = rpc(
        "eth_getLogs",
        [{"address": chainbuy_address(), "fromBlock": "0x0", "toBlock": "latest", "topics": [DEPOSITED_TOPIC, "0x" + encode(["uint256"], [group_id]).hex()]}],
    )
    seen: list[str] = []
    for lg in logs:
        addr = "0x" + lg["topics"][2][-40:]
        if addr.lower() not in (s.lower() for s in seen):
            seen.append(addr)
    return seen


def decode_uint(hexdata: str) -> int:
    return decode(["uint256"], bytes.fromhex(hexdata[2:]))[0]
