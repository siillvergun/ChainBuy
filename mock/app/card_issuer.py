"""mock 일회용 가상카드 발급사 (경로 B)

흐름: AI 에이전트가 컨트랙트 fundCard로 이 발급사 지갑에 충전 → 카드 발급 요청 → 쇼핑몰에서 카드 결제
     → 카드 폐기 시 남은 금액을 컨트랙트 returnRemainder로 돌려준다.
카드 제한: 한도(= 충전액) · 1회 사용 · 가맹점 고정 · 유효 기간 (PB-01, PB-04)
쇼핑몰 주문이 취소돼 카드에 환불이 들어오면 컨트랙트 returnRefund로 돌려준다 (PB-06).
유효 기간이 지난 카드는 sweep_expired가 자동으로 폐기해 잔액을 돌려준다.
"""

import secrets
import time

from eth_account import Account
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import eth, store
from .config import settings

router = APIRouter(prefix="/card", tags=["카드 발급사"])

TOKEN_DECIMALS = 10**6  # ChainBuyUSD 소수점 6자리, 화면 단위는 원


def _card_out(c: dict) -> dict:
    return {k: v for k, v in c.items()}


class IssueIn(BaseModel):
    groupId: int = Field(gt=0)


@router.post("/api/cards", status_code=201)
def issue(body: IssueIn):
    """공구 1건 전용 카드. 체인에 충전된 금액(cardFunded)을 한도로 한다"""
    cards = store.table("cards")
    existing = next((c for c in cards.values() if c["groupId"] == body.groupId), None)
    if existing:
        return existing
    g = eth.get_group(body.groupId)
    issuer = Account.from_key(settings().card_issuer_key).address
    if g["kind"] != 1 or g["status"] != 5 or g["payee"].lower() != issuer.lower() or g["cardFunded"] == 0:
        raise HTTPException(409, "이 공구는 카드가 충전되지 않았어요 (fundCard 먼저)")
    cid = f"card_{secrets.token_hex(4)}"
    c = {
        "cardId": cid,
        "groupId": body.groupId,
        "number": "9" + "".join(secrets.choice("0123456789") for _ in range(15)),
        "cvc": "".join(secrets.choice("0123456789") for _ in range(3)),
        "exp": time.strftime("%m/%y", time.localtime(time.time() + 365 * 86400)),
        "limit": g["cardFunded"] // TOKEN_DECIMALS,  # 원 단위
        "spent": 0,
        "merchant": settings().merchant_id,
        "expiresAt": int((time.time() + settings().card_ttl_hours * 3600) * 1000),
        "status": "active",  # active | used | closed
        "returned": None,
    }
    cards[cid] = c
    store.save()
    return c


def authorize(number: str, cvc: str, exp: str, amount: int, merchant: str) -> dict:
    """쇼핑몰의 결제 승인 요청. 제한을 어기면 거부 (PB-04)"""
    c = next((x for x in store.table("cards").values() if x["number"] == number), None)
    if not c or c["cvc"] != cvc or c["exp"] != exp:
        raise HTTPException(402, "카드 정보가 맞지 않아요")
    if c["status"] != "active":
        raise HTTPException(402, "이미 사용했거나 폐기된 카드예요 (1회용)")
    if c["expiresAt"] < time.time() * 1000:
        raise HTTPException(402, "유효 기간이 지난 카드예요")
    if merchant != c["merchant"]:
        raise HTTPException(402, "이 카드는 지정된 쇼핑몰에서만 쓸 수 있어요")
    if amount > c["limit"]:
        raise HTTPException(402, f"한도 초과 (한도 {c['limit']:,}원, 요청 {amount:,}원)")
    c["spent"], c["status"] = amount, "used"
    store.save()
    return {"approvalId": f"APV-{secrets.token_hex(4).upper()}", "amount": amount, "cardId": c["cardId"]}


@router.get("/api/cards/{cid}")
def get_card(cid: str):
    c = store.table("cards").get(cid)
    if not c:
        raise HTTPException(404, "카드가 없어요")
    return c


def _ensure_allowance(amount: int) -> None:
    s = settings()
    dep = eth.deployment()
    issuer = Account.from_key(s.card_issuer_key).address
    (allowance,) = eth.call(dep["ChainBuyUSD"], "allowance", ["address", "address"], [issuer, dep["ChainBuy"]], ["uint256"])
    if allowance < amount:
        eth.send(s.card_issuer_key, dep["ChainBuyUSD"], eth.calldata("approve", ["address", "uint256"], [dep["ChainBuy"], 2**256 - 1]))


def _send_to_contract(fn: str, group_id: int, amount: int) -> None:
    """returnRemainder 또는 returnRefund 호출 (amount는 토큰 최소 단위)"""
    if amount > 0:
        _ensure_allowance(amount)
    s = settings()
    eth.send(s.card_issuer_key, eth.deployment()["ChainBuy"], eth.calldata(fn, ["uint256", "uint256"], [group_id, amount]))


@router.post("/api/cards/{cid}/close")
def close(cid: str):
    """카드 폐기 + 잔액을 컨트랙트로 반환 (returnRemainder). 결제 실패로 전액 반환되면 공구는 취소·전액 환불된다.
    이미 타임아웃 정산(settleCardTimeout)된 공구면 잔액을 returnRefund로 돌려준다."""
    c = get_card(cid)
    if c["status"] == "closed":
        return c
    remainder = (c["limit"] - c["spent"]) * TOKEN_DECIMALS
    g = eth.get_group(c["groupId"])
    if not g["remainderReturned"]:
        _send_to_contract("returnRemainder", c["groupId"], remainder)
    elif remainder > 0:
        _send_to_contract("returnRefund", c["groupId"], remainder)
    c["status"], c["returned"] = "closed", remainder // TOKEN_DECIMALS
    store.save()
    return c


def refund_to_card(cid: str, amount: int) -> dict:
    """쇼핑몰 주문 취소 환불(원 단위)이 카드로 들어옴 (PB-06).
    카드가 아직 열려 있으면 잔액에 더해 두고(폐기할 때 함께 반환), 이미 폐기됐으면 바로 컨트랙트로 돌려준다."""
    c = get_card(cid)
    if c["status"] != "closed":
        c["spent"] = max(0, c["spent"] - amount)
        store.save()
        return c
    g = eth.get_group(c["groupId"])
    if g["status"] != 5:  # PAID 가 아니면 (배송 완료 등) 컨트랙트가 받지 않는다
        raise HTTPException(409, "배송이 끝난 공구라 환불을 컨트랙트로 돌려줄 수 없어요. 담당자 이의 처리로 진행해 주세요.")
    _send_to_contract("returnRefund", c["groupId"], amount * TOKEN_DECIMALS)
    c["refunded"] = c.get("refunded", 0) + amount
    store.save()
    return c


def sweep_expired() -> list[str]:
    """유효 기간이 지났는데 폐기되지 않은 카드를 폐기하고 잔액을 반환한다"""
    now_ms = time.time() * 1000
    closed = []
    for c in list(store.table("cards").values()):
        if c["status"] != "closed" and c["expiresAt"] < now_ms:
            close(c["cardId"])
            closed.append(c["cardId"])
    return closed
