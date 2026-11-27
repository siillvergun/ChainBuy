"""계정 추상화 (ERC-4337 v0.7): 참여자 스마트 지갑 · 가스비 대납 서명 · 번들러 제출

흐름
1. prepare: 프론트가 보낸 스마트 지갑 호출(execute/executeBatch)을 검사·모의 실행하고,
   UserOperation을 채운 뒤 플랫폼(sponsor)이 "가스비를 내 주겠다"고 서명한다 → 프론트에 userOpHash를 돌려준다
2. 사용자가 MetaMask로 userOpHash에 서명한다 (ETH 필요 없음)
3. send: 사용자 서명을 확인하고, 우리 서버가 번들러로서 EntryPoint.handleOps에 제출한다.
   가스비는 서버 지갑이 먼저 내고, EntryPoint가 Paymaster 예치금에서 돌려준다.

대납 남용은 두 겹으로 막는다: 여기서의 검사·횟수 제한 + Paymaster 컨트랙트의 체인 위 규칙.
"""

from functools import lru_cache

from eth_abi import decode, encode
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak, to_checksum_address

from .config import account_abstraction_addresses, chainbuy_abi, settings
from .errors import ApiError
from .eth_tx import rpc, send_and_wait

USER_OPERATION_TYPE = "(address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)"
USER_OPERATION_FIELDS = [
    "sender", "nonce", "initCode", "callData", "accountGasLimits",
    "preVerificationGas", "gasFees", "paymasterAndData", "signature",
]

# 가스 한도 (넉넉하게 잡되, Paymaster 예치금에서 미리 잡아 두는 금액이 너무 커지지 않게)
VERIFICATION_GAS_WITH_ACCOUNT_CREATION = 500_000
VERIFICATION_GAS = 150_000
CALL_GAS = 400_000
PAYMASTER_VERIFICATION_GAS = 150_000
PAYMASTER_POST_OP_GAS = 0
PRE_VERIFICATION_GAS = 60_000
SPONSOR_SIGNATURE_VALID_SECONDS = 300


def _selector(signature: str) -> bytes:
    return keccak(text=signature)[:4]


EXECUTE = _selector("execute(address,uint256,bytes)")
EXECUTE_BATCH = _selector("executeBatch(address[],uint256[],bytes[])")

CHAINBUY_SPONSORED = {
    _selector("deposit(uint256,uint32,bytes32)"): "참여",
    _selector("withdraw(uint256)"): "참여 취소",
    _selector("refund(uint256)"): "환불",
    _selector("confirmReceipt(uint256)"): "수령 확인",
    _selector("dispute(uint256,bytes32)"): "이의 제기",
}
TOKEN_MINT = _selector("mint(address,uint256)")
TOKEN_APPROVE = _selector("approve(address,uint256)")

USER_OPERATION_EVENT = "0x" + keccak(text="UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)").hex()
USER_OPERATION_REVERT_REASON = "0x" + keccak(text="UserOperationRevertReason(bytes32,address,uint256,bytes)").hex()


# ─────────────── 체인 읽기 ───────────────


def _eth_call(to: str, data: bytes, sender: str | None = None) -> bytes:
    call = {"to": to, "data": "0x" + data.hex()}
    if sender:
        call["from"] = sender
    return bytes.fromhex(rpc("eth_call", [call, "latest"])[2:])


def account_of(owner: str) -> str:
    """주인(MetaMask) 주소로 스마트 지갑 주소를 계산한다. 아직 배포 전이어도 주소는 정해져 있다 (CREATE2)"""
    factory = account_abstraction_addresses()["accountFactory"]
    data = _selector("getAddress(address,uint256)") + encode(["address", "uint256"], [owner, 0])
    (account,) = decode(["address"], _eth_call(factory, data))
    return to_checksum_address(account)


def is_deployed(account: str) -> bool:
    return rpc("eth_getCode", [account, "latest"]) not in ("0x", "0x0")


def _init_code(owner: str) -> bytes:
    factory = account_abstraction_addresses()["accountFactory"]
    create = _selector("createAccount(address,uint256)") + encode(["address", "uint256"], [owner, 0])
    return bytes.fromhex(factory[2:]) + create


def _nonce(account: str) -> int:
    entry_point = account_abstraction_addresses()["entryPoint"]
    (nonce,) = decode(["uint256"], _eth_call(entry_point, _selector("getNonce(address,uint192)") + encode(["address", "uint192"], [account, 0])))
    return nonce


@lru_cache
def _sponsored_targets() -> tuple[str, str]:
    """Paymaster 컨트랙트에 적힌 ChainBuy · 토큰 주소 (체인이 기준)"""
    paymaster = account_abstraction_addresses()["paymaster"]
    (chainbuy,) = decode(["address"], _eth_call(paymaster, _selector("chainBuy()")))
    (token,) = decode(["address"], _eth_call(paymaster, _selector("token()")))
    return to_checksum_address(chainbuy), to_checksum_address(token)


def _latest_block() -> dict:
    return rpc("eth_getBlockByNumber", ["latest", False])


# ─────────────── 대납 정책 ───────────────


def _decode_account_call(call_data: bytes) -> list[tuple[str, int, bytes]]:
    """스마트 지갑 호출(execute / executeBatch)을 (대상, ETH, 호출 데이터) 목록으로 푼다"""
    selector, args = call_data[:4], call_data[4:]
    if selector == EXECUTE:
        target, value, data = decode(["address", "uint256", "bytes"], args)
        return [(to_checksum_address(target), value, data)]
    if selector == EXECUTE_BATCH:
        targets, values, datas = decode(["address[]", "uint256[]", "bytes[]"], args)
        if len(targets) != len(datas) or (values and len(values) != len(targets)):
            raise ApiError(400, "호출 목록의 길이가 맞지 않아요.")
        return [(to_checksum_address(t), values[i] if values else 0, datas[i]) for i, t in enumerate(targets)]
    raise ApiError(400, "스마트 지갑의 execute 또는 executeBatch 호출만 대납해요.")


def _first_address(data: bytes) -> str | None:
    if len(data) < 36:
        return None
    (address,) = decode(["address"], data[4:36])
    return to_checksum_address(address)


def check_sponsored_calls(account: str, call_data: bytes) -> list[str]:
    """Paymaster 컨트랙트와 같은 규칙으로 미리 검사해 알아보기 쉬운 오류를 돌려준다. 통과하면 작업 이름 목록"""
    chainbuy, token = _sponsored_targets()
    actions = []
    for target, value, data in _decode_account_call(call_data):
        selector = data[:4]
        if value != 0:
            raise ApiError(400, "ETH를 보내는 호출은 대납하지 않아요.")
        if target == chainbuy and selector in CHAINBUY_SPONSORED:
            actions.append(CHAINBUY_SPONSORED[selector])
        elif target == token and selector == TOKEN_MINT and _first_address(data) == account:
            actions.append("테스트 토큰 받기")
        elif target == token and selector == TOKEN_APPROVE and _first_address(data) == chainbuy:
            actions.append("토큰 사용 승인")
        else:
            raise ApiError(400, "ChainBuy 참여 기능이 아닌 호출은 가스비를 대신 내 주지 않아요.")
    return actions


@lru_cache
def _known_errors() -> dict[bytes, str]:
    """체인 오류 선택자 → 이름 (ChainBuy·OpenZeppelin 오류를 사람이 읽을 수 있게)"""
    names = {}
    for item in chainbuy_abi():
        if item.get("type") == "error":
            types = ",".join(i["type"] for i in item["inputs"])
            names[_selector(f"{item['name']}({types})")] = item["name"]
    names[_selector("ERC20InsufficientBalance(address,uint256,uint256)")] = "ERC20InsufficientBalance"
    names[_selector("ERC20InsufficientAllowance(address,uint256,uint256)")] = "ERC20InsufficientAllowance"
    return names


def _error_name(revert_data: bytes) -> str:
    return _known_errors().get(revert_data[:4], "알 수 없는 오류")


def simulate(account: str, call_data: bytes) -> None:
    """사용자가 서명하기 전에 실제로 성공할지 모의 실행한다 (실패할 요청에 가스비를 쓰지 않으려고).
    스마트 지갑이 이미 있으면 EntryPoint가 부르는 것처럼 eth_call 한다."""
    if not is_deployed(account):
        return  # 첫 요청(지갑 생성 + 토큰 받기)은 지갑이 없어 모의 실행을 건너뛴다
    entry_point = account_abstraction_addresses()["entryPoint"]
    try:
        _eth_call(account, call_data, sender=entry_point)
    except RuntimeError as e:
        raise ApiError(400, f"체인에서 거절될 요청이에요: {e}")


# ─────────────── UserOperation 만들기 · 서명 ───────────────


def _pack_two_uint128(high: int, low: int) -> bytes:
    return ((high << 128) | low).to_bytes(32, "big")


def _paymaster_prefix() -> bytes:
    paymaster = account_abstraction_addresses()["paymaster"]
    return bytes.fromhex(paymaster[2:]) + PAYMASTER_VERIFICATION_GAS.to_bytes(16, "big") + PAYMASTER_POST_OP_GAS.to_bytes(16, "big")


def _as_tuple(op: dict) -> tuple:
    return tuple(op[f] for f in USER_OPERATION_FIELDS)


def user_op_hash(op: dict) -> bytes:
    entry_point = account_abstraction_addresses()["entryPoint"]
    data = _selector(f"getUserOpHash({USER_OPERATION_TYPE})") + encode([USER_OPERATION_TYPE], [_as_tuple(op)])
    (h,) = decode(["bytes32"], _eth_call(entry_point, data))
    return h


def _sponsor_sign(op: dict) -> bytes:
    """플랫폼이 이 요청의 가스비를 내겠다고 서명한다. 유효 시간 SPONSOR_SIGNATURE_VALID_SECONDS"""
    paymaster = account_abstraction_addresses()["paymaster"]
    valid_until = int(_latest_block()["timestamp"], 16) + SPONSOR_SIGNATURE_VALID_SECONDS
    valid_after = 0
    data = _selector(f"getHash({USER_OPERATION_TYPE},uint48,uint48)") + encode(
        [USER_OPERATION_TYPE, "uint48", "uint48"], [_as_tuple(op), valid_until, valid_after]
    )
    (h,) = decode(["bytes32"], _eth_call(paymaster, data))
    signature = Account.sign_message(encode_defunct(primitive=h), settings().sponsor_key).signature
    return _paymaster_prefix() + encode(["uint48", "uint48"], [valid_until, valid_after]) + signature


def prepare(owner: str, call_data: bytes) -> dict:
    """사용자가 서명할 UserOperation을 만든다 (가스비 대납 서명 포함)"""
    account = account_of(owner)
    actions = check_sponsored_calls(account, call_data)
    simulate(account, call_data)

    deployed = is_deployed(account)
    block = _latest_block()
    base_fee = int(block.get("baseFeePerGas", "0x0"), 16)
    priority_fee = int(rpc("eth_maxPriorityFeePerGas", []), 16)
    verification_gas = VERIFICATION_GAS if deployed else VERIFICATION_GAS_WITH_ACCOUNT_CREATION

    op = {
        "sender": account,
        "nonce": _nonce(account),
        "initCode": b"" if deployed else _init_code(owner),
        "callData": call_data,
        "accountGasLimits": _pack_two_uint128(verification_gas, CALL_GAS),
        "preVerificationGas": PRE_VERIFICATION_GAS,
        "gasFees": _pack_two_uint128(priority_fee, base_fee * 2 + priority_fee),
        # 서명 전 해시 계산용: 가스 한도까지만 채운다 (Paymaster.getHash는 이 부분만 읽음)
        "paymasterAndData": _paymaster_prefix() + encode(["uint48", "uint48"], [0, 0]),
        "signature": b"",
    }
    op["paymasterAndData"] = _sponsor_sign(op)
    return {"userOp": to_json(op), "userOpHash": "0x" + user_op_hash(op).hex(), "account": account, "actions": actions}


# ─────────────── 제출 (번들러) ───────────────


def to_json(op: dict) -> dict:
    out = {}
    for f in USER_OPERATION_FIELDS:
        v = op[f]
        out[f] = hex(v) if isinstance(v, int) else ("0x" + v.hex() if isinstance(v, bytes) else v)
    return out


def from_json(raw: dict) -> dict:
    try:
        return {
            "sender": to_checksum_address(raw["sender"]),
            "nonce": int(raw["nonce"], 16),
            "initCode": bytes.fromhex(raw["initCode"][2:]),
            "callData": bytes.fromhex(raw["callData"][2:]),
            "accountGasLimits": bytes.fromhex(raw["accountGasLimits"][2:]),
            "preVerificationGas": int(raw["preVerificationGas"], 16),
            "gasFees": bytes.fromhex(raw["gasFees"][2:]),
            "paymasterAndData": bytes.fromhex(raw["paymasterAndData"][2:]),
            "signature": bytes.fromhex(raw["signature"][2:]),
        }
    except (KeyError, ValueError, TypeError):
        raise ApiError(400, "UserOperation 형식이 맞지 않아요.")


def verify_owner_signature(owner: str, op: dict) -> bytes:
    """사용자가 MetaMask로 서명한 것이 맞는지 미리 확인한다 (틀린 요청에 가스비를 쓰지 않으려고)"""
    if op["sender"] != account_of(owner):
        raise ApiError(403, "내 스마트 지갑의 요청이 아니에요.")
    h = user_op_hash(op)
    try:
        signer = Account.recover_message(encode_defunct(primitive=h), signature=op["signature"])
    except Exception:
        raise ApiError(400, "서명 형식이 맞지 않아요.")
    if signer.lower() != owner.lower():
        raise ApiError(400, "지갑 주인의 서명이 아니에요.")
    return h


HANDLE_OPS_OVERHEAD_GAS = 100_000


def _bundle_gas_limit(op: dict) -> int:
    """UserOperation 하나를 담은 handleOps 트랜잭션의 가스 한도"""
    limits = int.from_bytes(op["accountGasLimits"], "big")
    verification_gas, call_gas = limits >> 128, limits & ((1 << 128) - 1)
    return verification_gas + call_gas + PAYMASTER_VERIFICATION_GAS + PAYMASTER_POST_OP_GAS + op["preVerificationGas"] + HANDLE_OPS_OVERHEAD_GAS


def submit(op: dict, h: bytes) -> dict:
    """EntryPoint.handleOps로 제출하고, 스마트 지갑 안의 호출까지 성공했는지 확인한다"""
    entry_point = account_abstraction_addresses()["entryPoint"]
    sponsor = Account.from_key(settings().sponsor_key).address
    data = _selector(f"handleOps({USER_OPERATION_TYPE}[],address)") + encode([f"{USER_OPERATION_TYPE}[]", "address"], [[_as_tuple(op)], sponsor])
    # handleOps는 추정(eth_estimateGas)이 들쭉날쭉해서, 번들러들처럼 요청에 적힌 가스 한도의 합 + 여유분으로 보낸다
    try:
        receipt = send_and_wait(settings().sponsor_key, "0x" + data.hex(), to=entry_point, gas=_bundle_gas_limit(op))
    except RuntimeError as e:
        raise ApiError(400, f"EntryPoint가 요청을 받지 않았어요: {e}")

    op_hash_topic = "0x" + h.hex()
    success, reason = False, None
    for log in receipt["logs"]:
        topics = [t.lower() for t in log["topics"]]
        if len(topics) < 2 or topics[1] != op_hash_topic:
            continue
        if topics[0] == USER_OPERATION_EVENT:
            (_, success, _, _) = decode(["uint256", "bool", "uint256", "uint256"], bytes.fromhex(log["data"][2:]))
        elif topics[0] == USER_OPERATION_REVERT_REASON:
            (_, revert_data) = decode(["uint256", "bytes"], bytes.fromhex(log["data"][2:]))
            reason = _error_name(revert_data)
    return {"txHash": receipt["transactionHash"], "success": bool(success), "reason": reason}
