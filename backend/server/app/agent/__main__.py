"""AI 구매 대행 에이전트 (AGENT 역할 지갑)

실행: python -m app.agent      (backend/server 폴더에서)

주기적으로 모든 공구를 보고 지금 할 일을 한다. 할 일은 컨트랙트 상태로 정해지므로,
에이전트를 껐다 켜도 이어서 진행된다. 에이전트가 할 수 있는 일은 컨트랙트가 정한 범위
(등록된 결제 대상·한도 안 결제, 1회)로 제한되고, 결제는 담당자 승인 뒤에만 가능하다.

  모집 중      → 마감됐거나 목표가 차면 finalize
  확인 대기    → 상품 확인(가격·재고·옵션) → submitCheck / 조건이 안 맞으면 cancel
               → 승인 기한 7일이 지나면 cancel
  승인됨       → 경로 A: payListed
               → 경로 B: fundCard → 일회용 카드 발급 → 쇼핑몰 주문 → 카드 폐기(잔액 반환)
  결제 완료    → 운송장이 있으면 주문 증거(submitOrderProof) → 택배 배송 완료면 markShipped
  배송 완료    → 수령 확인했거나 7일 지난 참여자 몫 releaseFee
"""

import json
import time
import traceback

import httpx
from eth_utils import keccak
from sqlalchemy import select

from ..auth import now_ms
from ..chain import call, group_count, id_hash, onchain_group, participant
from ..config import settings
from ..db import SessionLocal
from ..eth_tx import calldata, participants, send
from ..models import AgentLog, Product, Proposal, Shipment
from .reader import read_product

UNIT = 10**6  # 토큰 소수점 6자리 (화면 단위 원)
DAY_MS = 86_400_000
CARD_RETURN_WINDOW_MS = 3 * DAY_MS  # 컨트랙트 CARD_RETURN_WINDOW와 같음
STATUS = ["OPEN", "FAILED", "PENDING_CHECK", "CANCELLED", "APPROVED", "PAID", "SHIPPED", "COMPLETED"]


def log(group_id: int, action: str, message: str, detail: dict | None = None, tx: str | None = None) -> None:
    with SessionLocal() as db:
        last = db.scalar(select(AgentLog).where(AgentLog.group_id == group_id).order_by(AgentLog.id.desc()).limit(1))
        # 같은 에러가 매 주기 반복해서 쌓이지 않게 (10분 안의 같은 메시지는 건너뜀)
        if action == "error" and last and last.message == message and now_ms() - last.created_at < 10 * 60 * 1000:
            return
    print(f"[#{group_id}] {action}: {message}" + (f" ({tx})" if tx else ""), flush=True)
    with SessionLocal() as db:
        db.add(AgentLog(group_id=group_id, action=action, message=message, detail=json.dumps(detail, ensure_ascii=False) if detail else None, tx_hash=tx, created_at=now_ms()))
        db.commit()


def tx(name: str, types: list[str], args: list) -> str:
    return send(settings().agent_key, calldata(name, types, args))


def mock(method: str, path: str, **kw):
    res = httpx.request(method, settings().mock_url + path, timeout=30, **kw)
    if res.status_code >= 400:
        try:
            msg = res.json().get("detail", res.text)
        except ValueError:
            msg = res.text
        raise RuntimeError(f"{path}: {msg}")
    return res.json() if "json" in res.headers.get("content-type", "") else res.text


# ─────────────── 단계별 처리 ───────────────


def on_open(gid: int, g: dict) -> None:
    if g["totalQty"] == g["targetQty"] or g["deadline"] * 1000 <= time.time() * 1000:
        h = tx("finalize", ["uint256"], [gid])
        log(gid, "finalize", "목표 달성 → 상품 확인 단계" if g["totalQty"] == g["targetQty"] else "마감 → 목표 미달이면 전액 환불", tx=h)


def check_listed(gid: int, g: dict) -> dict:
    """입점 상품: 판매자가 등록한 상품 정보의 공구가를 현재 가격으로 본다"""
    with SessionLocal() as db:
        pid = _product_id_for(db, g)
        p = db.get(Product, pid) if pid else None
    if not p:
        return {"price": g["maxPrice"] // UNIT, "inStock": True, "options": [], "method": "listed-default"}
    return {"price": p.price, "inStock": True, "options": [p.option], "method": "listed", "product": p.name}


def _product_id_for(db, g: dict) -> str | None:
    for p in db.scalars(select(Product)).all():
        if id_hash(p.id) == g["productHash"]:
            return p.id
    return None


def _proposal_for(gid: int):
    with SessionLocal() as db:
        row = db.execute(select(Proposal, Product).join(Product, Product.id == Proposal.product_id).where(Proposal.group_id == gid)).first()
        return row if row else (None, None)


def check_external(gid: int, g: dict) -> dict:
    pr, p = _proposal_for(gid)
    if not pr:
        raise RuntimeError("이 외부 공구의 제안 정보를 찾지 못했어요")
    item = mock("POST", "/shop/api/lookup", json={"url": p.url, "name": p.name, "option": p.option, "price": p.original_price})
    page = mock("GET", f"/shop/products/{item['id']}")
    r = read_product(page)
    r["shopProductId"] = item["id"]
    r["wantedOption"] = p.option
    r["product"] = p.name
    return r


def on_pending(gid: int, g: dict) -> None:
    if g["pendingSince"] * 1000 + 7 * DAY_MS < time.time() * 1000:
        h = tx("cancel", ["uint256"], [gid])
        log(gid, "cancel", "승인 기한 7일 초과 → 취소, 전액 환불", tx=h)
        return
    if g["checkSubmitted"]:
        return  # 담당자 승인 대기
    r = check_listed(gid, g) if g["kind"] == 0 else check_external(gid, g)
    max_price = g["maxPrice"] // UNIT
    reasons = []
    if r["price"] is None:
        reasons.append("가격을 읽지 못함")
    elif r["price"] > max_price:
        reasons.append(f"가격 {r['price']:,}원 > 최대 {max_price:,}원")
    if not r["inStock"]:
        reasons.append("품절")
    if g["kind"] == 1 and r.get("options") and r.get("wantedOption") and not any(r["wantedOption"].split(" ·")[0] in o for o in r["options"]):
        reasons.append(f"옵션 '{r['wantedOption']}' 없음")
    if reasons:
        h = tx("cancel", ["uint256"], [gid])
        log(gid, "cancel", "조건 불일치 → 취소, 전액 환불: " + ", ".join(reasons), r, h)
        return
    result_hash = keccak(text=json.dumps(r, sort_keys=True, ensure_ascii=False))
    h = tx("submitCheck", ["uint256", "uint256", "bytes32"], [gid, r["price"] * UNIT, result_hash])
    log(gid, "check", f"상품 확인 완료: {r['price']:,}원 (최대 {max_price:,}원) · 담당자 승인 대기", r, h)


def on_approved(gid: int, g: dict) -> None:
    if g["kind"] == 0:
        h = tx("payListed", ["uint256"], [gid])
        log(gid, "pay", f"판매자 지갑으로 결제 ({g['checkedPrice'] // UNIT:,}원 × {g['totalQty']}개, 수수료 제외)", tx=h)
        return
    # 경로 B: 한도(최대 가격 × 수량)까지 카드 충전
    limit = g["maxPrice"] * g["totalQty"]
    h = tx("fundCard", ["uint256", "uint256"], [gid, limit])
    log(gid, "fund_card", f"일회용 카드 충전 {limit // UNIT:,}원 (한도)", tx=h)


def buy_with_card(gid: int, g: dict) -> None:
    """경로 B 결제 완료(충전) 후: 카드 발급 → 주문 → 카드 폐기(잔액 반환) → 운송장 등록"""
    with SessionLocal() as db:
        if db.get(Shipment, gid):
            return
    pr, p = _proposal_for(gid)
    card = mock("POST", "/card/api/cards", json={"groupId": gid})
    item = mock("POST", "/shop/api/lookup", json={"url": p.url, "name": p.name, "option": p.option, "price": p.original_price})
    try:
        order = mock(
            "POST",
            "/shop/api/orders",
            json={"productId": item["id"], "option": p.option, "qty": g["totalQty"], "card": {"number": card["number"], "cvc": card["cvc"], "exp": card["exp"]}},
        )
    except RuntimeError as e:
        closed = mock("POST", f"/card/api/cards/{card['cardId']}/close")
        log(gid, "cancel", f"쇼핑몰 주문 실패 → 카드 전액 반환, 공구 취소·전액 환불: {e}", {"returned": closed.get("returned")})
        return
    closed = mock("POST", f"/card/api/cards/{card['cardId']}/close")
    log(gid, "order", f"쇼핑몰 주문 {order['orderId']} · {order['amount']:,}원 결제 · 잔액 {closed['returned']:,}원 반환", {"orderId": order["orderId"], "amount": order["amount"]})
    shipment = mock("POST", "/courier/api/shipments", json={"groupId": gid})
    with SessionLocal() as db:
        db.add(Shipment(group_id=gid, tracking_no=shipment["trackingNo"], carrier="mock", registered_by="agent", order_id=order["orderId"], created_at=now_ms()))
        db.commit()


def on_paid(gid: int, g: dict) -> None:
    if g["kind"] == 1 and not g["remainderReturned"]:
        (paid_at,), _ = call("paidAt", gid)
        paid_at_ms = paid_at * 1000
        if paid_at_ms + CARD_RETURN_WINDOW_MS < time.time() * 1000:
            # 카드 발급사가 3일 넘게 잔액을 안 돌려줌 → 충전액 전부를 결제액으로 확정하고 다음 단계로
            h = tx("settleCardTimeout", ["uint256"], [gid])
            log(gid, "timeout", "카드 잔액 반환이 3일 넘게 없어 충전액 전부를 결제액으로 확정", tx=h)
            return
        buy_with_card(gid, g)
        return
    with SessionLocal() as db:
        sh = db.get(Shipment, gid)
    if not sh:
        return  # 입점 상품: 판매자가 운송장을 등록할 때까지 대기
    if g["orderHash"] == "0x" + "00" * 32:
        proof = keccak(text=f"{sh.order_id or ''}|{sh.carrier}|{sh.tracking_no}")
        h = tx("submitOrderProof", ["uint256", "bytes32"], [gid, proof])
        log(gid, "proof", f"주문 증거 기록 (운송장 {sh.tracking_no})", tx=h)
        return
    t = mock("GET", f"/courier/api/tracking/{sh.tracking_no}")
    if t["status"] == "delivered":
        h = tx("markShipped", ["uint256"], [gid])
        log(gid, "shipped", "배송 완료 → 이의 기간 7일 시작", tx=h)


def on_shipped(gid: int, g: dict) -> None:
    expired = g["shippedAt"] * 1000 + 7 * DAY_MS < time.time() * 1000
    for user in participants(gid):
        p = participant(gid, user)
        if p["qty"] == 0 or p["feeSettled"]:
            continue
        if p["receipt"] == 1 or (p["receipt"] == 0 and expired):
            h = tx("releaseFee", ["uint256", "address"], [gid, user])
            log(gid, "fee", f"수수료 지급 ({'수령 확인' if p['receipt'] == 1 else '7일 경과'}) {user[:6]}…{user[-4:]}", tx=h)


HANDLERS = {"OPEN": on_open, "PENDING_CHECK": on_pending, "APPROVED": on_approved, "PAID": on_paid, "SHIPPED": on_shipped}


def tick() -> None:
    for gid in range(1, group_count() + 1):
        g = onchain_group(gid)
        if not g:
            continue
        handler = HANDLERS.get(STATUS[g["status"]])
        if not handler:
            continue
        try:
            handler(gid, g)
        except Exception as e:
            traceback.print_exc()
            log(gid, "error", f"{STATUS[g['status']]} 처리 실패: {str(e)[:300]}")


def main() -> None:
    s = settings()
    print(f"ChainBuy 에이전트 시작 · {s.agent_interval_seconds}초마다 · LLM {'사용' if s.llm_api_key else '없음(규칙 기반)'}", flush=True)
    while True:
        try:
            tick()
        except Exception:
            traceback.print_exc()
        time.sleep(s.agent_interval_seconds)


if __name__ == "__main__":
    main()
