"""mock 택배사: 운송장 생성·조회. 생성 후 delivery_seconds가 지나면 자동으로 배송 완료 (데모용)"""

import secrets
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import store
from .config import settings

router = APIRouter(prefix="/courier", tags=["택배사"])


class ShipmentIn(BaseModel):
    trackingNo: str | None = None  # 판매자가 이미 받은 운송장 번호가 있으면 그대로
    groupId: int = Field(gt=0)
    recipientHashes: list[str] = []


@router.post("/api/shipments", status_code=201)
def create(body: ShipmentIn):
    no = body.trackingNo or "".join(secrets.choice("0123456789") for _ in range(12))
    sh = store.table("shipments").get(no)
    if not sh:
        sh = {"trackingNo": no, "groupId": body.groupId, "recipientHashes": body.recipientHashes, "createdAt": int(time.time() * 1000), "deliveredAt": None}
        store.table("shipments")[no] = sh
        store.save()
    return track(no)


@router.get("/api/tracking/{no}")
def track(no: str):
    sh = store.table("shipments").get(no)
    if not sh:
        raise HTTPException(404, "운송장이 없어요")
    if not sh["deliveredAt"] and time.time() * 1000 - sh["createdAt"] > settings().delivery_seconds * 1000:
        sh["deliveredAt"] = sh["createdAt"] + settings().delivery_seconds * 1000
        store.save()
    return {**sh, "status": "delivered" if sh["deliveredAt"] else "in_transit"}


@router.post("/api/tracking/{no}/deliver")
def deliver(no: str):
    """데모 조작: 바로 배송 완료"""
    sh = store.table("shipments").get(no)
    if not sh:
        raise HTTPException(404, "운송장이 없어요")
    sh["deliveredAt"] = sh["deliveredAt"] or int(time.time() * 1000)
    store.save()
    return track(no)
