"""판매자 주문 관리 (PA-03, PA-04): 내 공구의 참여자 배송지 목록 · 운송장 등록

- 참여자 목록은 체인(Deposited 이벤트 + getParticipant)이 기준이고, 배송지 원문은 서버 DB에서 붙인다.
- 참여할 때 체인에 남긴 배송지 해시와 지금 배송지의 해시가 같은지 함께 보여 준다 (중간에 바꿨는지 확인).
- 운송장을 등록하면 택배사(mock)에도 등록하고, 에이전트가 주문 증거 → 배송 완료를 처리한다.
"""

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import AUTH, DB, CurrentUser, now_ms
from ..chain import id_hash, onchain_group, participant
from ..config import settings
from ..db import CommitRoute
from ..errors import ApiError
from ..eth_tx import participants
from ..models import Seller, Shipment, User
from .users import recipient_hash

router = APIRouter(route_class=CommitRoute)

STATUS = ["OPEN", "FAILED", "PENDING_CHECK", "CANCELLED", "APPROVED", "PAID", "SHIPPED", "COMPLETED"]


def my_group(db: Session, user: CurrentUser, group_id: int) -> dict:
    seller = db.scalar(select(Seller).where(Seller.address == user.address, Seller.status == "approved"))
    if not seller:
        raise ApiError(403, "승인된 판매자만 볼 수 있어요.")
    g = onchain_group(group_id)
    if not g or g["kind"] != 0 or g["partyId"] != id_hash(seller.id):
        raise ApiError(403, "내가 연 공구가 아니에요.")
    return g


def shipment_out(sh: Shipment | None) -> dict | None:
    if not sh:
        return None
    status = None
    try:
        t = httpx.get(f"{settings().mock_url}/courier/api/tracking/{sh.tracking_no}", timeout=5).json()
        status = t.get("status")
    except Exception:
        pass
    return {"trackingNo": sh.tracking_no, "carrier": sh.carrier, "createdAt": sh.created_at, "deliveryStatus": status}


@router.get("/seller/groups/{group_id}/orders")
def orders(group_id: int, user: CurrentUser = AUTH, db: Session = DB):
    g = my_group(db, user, group_id)
    rows = []
    for wallet in participants(group_id):
        p = participant(group_id, wallet)
        if p["qty"] == 0:
            continue
        u = db.get(User, wallet) or db.scalar(select(User).where(User.address.ilike(wallet)))
        current = recipient_hash(u) if u else None
        rows.append(
            {
                "address": wallet,
                "nickname": u.nickname if u else "",
                "qty": p["qty"],
                "shipping": (
                    {"name": u.ship_name, "phone": u.ship_phone, "zip": u.ship_zip, "address1": u.ship_addr1, "address2": u.ship_addr2 or ""}
                    if u and u.ship_name
                    else None
                ),
                # 참여할 때 체인에 남긴 배송지 해시와 지금 배송지가 같은지
                "shippingMatches": current is not None and current == p["recipientHash"],
            }
        )
    return {
        "groupId": group_id,
        "status": STATUS[g["status"]],
        "totalQty": g["totalQty"],
        "checkedPrice": g["checkedPrice"],
        "orders": rows,
        "shipment": shipment_out(db.get(Shipment, group_id)),
    }


class ShipmentIn(BaseModel):
    trackingNo: str = Field(pattern=r"^[0-9A-Za-z-]{6,30}$")
    carrier: str = Field(default="mock", max_length=20)


@router.post("/seller/groups/{group_id}/shipment", status_code=201)
def register_shipment(group_id: int, body: ShipmentIn, user: CurrentUser = AUTH, db: Session = DB):
    g = my_group(db, user, group_id)
    if STATUS[g["status"]] != "PAID":
        raise ApiError(409, "결제가 완료된 공구에만 운송장을 등록할 수 있어요.")
    if db.get(Shipment, group_id):
        raise ApiError(409, "이미 운송장을 등록했어요.")
    # 택배사(mock)에 운송장 등록 → 에이전트가 배송 완료를 확인한다
    try:
        httpx.post(f"{settings().mock_url}/courier/api/shipments", json={"trackingNo": body.trackingNo, "groupId": group_id}, timeout=10).raise_for_status()
    except Exception:
        raise ApiError(502, "택배사에 운송장을 등록하지 못했어요. 잠시 뒤 다시 시도해 주세요.")
    sh = Shipment(group_id=group_id, tracking_no=body.trackingNo, carrier=body.carrier, registered_by=user.address, created_at=now_ms())
    db.add(sh)
    db.flush()
    return shipment_out(sh)
