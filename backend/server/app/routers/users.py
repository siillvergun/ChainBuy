"""사용자 프로필·배송지 · 판매자 정보 수정 · 찜"""

import secrets

from eth_utils import keccak
from fastapi import APIRouter

from ..db import CommitRoute
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ..auth import AUTH, DB, CurrentUser, now_ms
from ..chain import onchain_group
from ..errors import ApiError
from ..models import Like, Seller, User

router = APIRouter(route_class=CommitRoute)


# ─────────────── 프로필·배송지 ───────────────
# 배송지 원문은 서버에만 두고, 체인에는 "솔트 + 배송지"의 해시(recipientHash)만 올린다 (DEP-04).
# 솔트가 사람마다 달라서 체인을 보고 주소를 추측해 맞춰 볼 수 없다.


def recipient_hash(u: User) -> str | None:
    if not u.ship_name or not u.ship_addr1:
        return None
    raw = "|".join([u.salt, u.ship_name, u.ship_phone or "", u.ship_zip or "", u.ship_addr1, u.ship_addr2 or ""])
    return "0x" + keccak(text=raw).hex()


def user_out(address: str, u: User | None) -> dict:
    return {
        "address": address,
        "nickname": u.nickname if u else "",
        "contact": u.contact if u else "",
        "shipping": (
            {"name": u.ship_name, "phone": u.ship_phone, "zip": u.ship_zip, "address1": u.ship_addr1, "address2": u.ship_addr2 or ""}
            if u and u.ship_name
            else None
        ),
        "recipientHash": recipient_hash(u) if u else None,
    }


class ShippingIn(BaseModel):
    name: str = Field(min_length=1, max_length=20, description="받는 사람")
    phone: str = Field(pattern=r"^[0-9-]{9,14}$", description="전화번호")
    zip: str = Field(pattern=r"^\d{5}$", description="우편번호 5자리")
    address1: str = Field(min_length=5, max_length=100, description="기본 주소")
    address2: str = Field(default="", max_length=60, description="상세 주소")

    @field_validator("name", "phone", "zip", "address1", "address2", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v


class UserIn(BaseModel):
    nickname: str = Field(default="", max_length=20, description="닉네임")
    contact: str = Field(default="", max_length=80, description="연락처")
    shipping: ShippingIn | None = Field(default=None, description="배송지 (null이면 삭제)")


@router.get("/users/me", summary="내 프로필·배송지")
def user_me(user: CurrentUser = AUTH, db: Session = DB):
    """체인에 올릴 배송지 해시(recipientHash)도 함께 돌려준다"""
    return user_out(user.address, db.get(User, user.address))


@router.put("/users/me", summary="내 프로필·배송지 저장")
def user_save(body: UserIn, user: CurrentUser = AUTH, db: Session = DB):
    """배송지 원문은 서버에만 저장하고, 체인에는 솔트를 섞은 해시만 올라간다"""
    u = db.get(User, user.address)
    if not u:
        u = User(address=user.address, salt=secrets.token_hex(16), updated_at=now_ms())
        db.add(u)
    s = body.shipping
    u.nickname, u.contact = body.nickname.strip(), body.contact.strip()
    u.ship_name = s.name if s else None
    u.ship_phone = s.phone if s else None
    u.ship_zip = s.zip if s else None
    u.ship_addr1 = s.address1 if s else None
    u.ship_addr2 = s.address2 if s else None
    u.updated_at = now_ms()
    db.flush()
    return user_out(user.address, u)


class SellerPatchIn(BaseModel):
    name: str = Field(min_length=2, max_length=40, description="상호")
    contact: str = Field(min_length=5, max_length=80, description="연락처")


@router.patch("/sellers/me", summary="판매자 정보 수정")
def seller_patch(body: SellerPatchIn, user: CurrentUser = AUTH, db: Session = DB):
    """판매자 정보 수정: 상호·연락처만 (사업자등록번호와 정산 지갑은 바꿀 수 없음)"""
    s = db.scalar(select(Seller).where(Seller.address == user.address, Seller.status != "rejected"))
    if not s:
        raise ApiError(404, "판매자 신청 내역이 없어요.")
    s.name, s.contact = body.name.strip(), body.contact.strip()
    return {"id": s.id, "name": s.name, "contact": s.contact, "status": s.status}


# ─────────────── 찜 ───────────────
# 참여(예치)하기 전에 관심 있는 공구를 담아 둔다. 돈과 무관해서 체인에 올리지 않는다.


@router.get("/likes", summary="내가 찜한 공구 번호")
def likes_mine(user: CurrentUser = AUTH, db: Session = DB):
    """최근에 찜한 순서"""
    return list(db.scalars(select(Like.group_id).where(Like.address == user.address).order_by(Like.created_at.desc())).all())


@router.get("/likes/counts", summary="공구별 찜 개수")
def likes_counts(db: Session = DB):
    """{공구 번호: 찜 개수} 형태"""
    rows = db.execute(select(Like.group_id, func.count()).group_by(Like.group_id)).all()
    return {str(gid): n for gid, n in rows}


@router.post("/likes/{group_id}", summary="공구 찜하기", status_code=201)
def like_add(group_id: int, user: CurrentUser = AUTH, db: Session = DB):
    """이미 찜했으면 그대로 둔다"""
    if group_id <= 0:
        raise ApiError(400, "공구 번호가 올바르지 않아요.")
    g = onchain_group(group_id)
    if not g or g["targetQty"] == 0:
        raise ApiError(404, "공구를 찾을 수 없어요.")
    db.execute(insert(Like).values(address=user.address, group_id=group_id, created_at=now_ms()).on_conflict_do_nothing())
    return {"groupId": group_id, "liked": True}


@router.delete("/likes/{group_id}", summary="찜 취소")
def like_remove(group_id: int, user: CurrentUser = AUTH, db: Session = DB):
    """찜하지 않은 공구여도 오류 없이 처리한다"""
    db.execute(delete(Like).where(Like.address == user.address, Like.group_id == group_id))
    return {"groupId": group_id, "liked": False}
