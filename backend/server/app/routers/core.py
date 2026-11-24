"""로그인 · 상품 · 판매자 입점 · 외부 상품 제안 · 담당자 API"""

import random
import secrets
from urllib.parse import urlparse

from fastapi import APIRouter, Body

from ..db import CommitRoute
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from sqlalchemy import case, select
from sqlalchemy.orm import Session

from ..auth import AUTH, DB, REVIEWER, CurrentUser, issue_nonce, now_ms, verify_login
from ..chain import id_hash, is_reviewer, onchain_group, onchain_seller
from ..config import ALLOWED_MALLS, CATEGORIES
from ..errors import ApiError
from ..models import Product, Proposal, Seller

router = APIRouter(route_class=CommitRoute)

TINTS = ["#EEF2F7", "#F1E8DC", "#E7EEE6", "#F2F4EE", "#EEF5F3", "#F4F1EC", "#F3ECE4", "#EDEBE3"]


def validate(model, raw: dict):
    """권한 확인 뒤에 입력값을 검증할 때 쓴다 (검증 실패는 400)"""
    try:
        return model.model_validate(raw)
    except ValidationError as e:
        msgs = []
        for x in e.errors():
            loc = ".".join(str(i) for i in x["loc"])
            msg = x["msg"].removeprefix("Value error, ")
            msgs.append(f"{loc}: {msg}" if loc else msg)
        raise ApiError(400, ", ".join(msgs))


def short_id() -> str:
    return secrets.token_hex(6)


# ─────────────── 공통 ───────────────


@router.get("/health")
def health():
    return {"ok": True}


class NonceIn(BaseModel):
    address: str = ""


@router.post("/auth/nonce")
def auth_nonce(body: NonceIn, db: Session = DB):
    return issue_nonce(db, body.address)


class VerifyIn(BaseModel):
    address: str
    signature: str = Field(pattern=r"^0x[0-9a-fA-F]+$")


@router.post("/auth/verify")
def auth_verify(body: VerifyIn, db: Session = DB):
    return verify_login(db, body.address, body.signature)


@router.get("/auth/me")
def auth_me(user: CurrentUser = AUTH):
    """저장해 둔 토큰이 아직 유효한지 확인 (만료 감지)"""
    return {"address": user.address, "expiresAt": user.expires_at, "isReviewer": is_reviewer(user.address)}


# ─────────────── 상품 ───────────────


def product_out(p: Product, seller_name: str | None = None) -> dict:
    return {
        "id": p.id,
        "productHash": id_hash(p.id),
        "kind": p.kind,
        "seller": p.seller_id,
        "sellerName": seller_name,
        "name": p.name,
        "category": p.category,
        "option": p.option,
        "originalPrice": p.original_price,
        "price": p.price,
        "description": p.description,
        "url": p.url,
        "tint": p.tint,
    }


@router.get("/products")
def products(db: Session = DB):
    rows = db.execute(
        select(Product, Seller.name).outerjoin(Seller, Seller.id == Product.seller_id).order_by(Product.created_at.desc())
    ).all()
    return [product_out(p, name) for p, name in rows]


# ─────────────── 판매자 (SEL) ───────────────


def seller_out(s: Seller) -> dict:
    return {
        "id": s.id,
        "sellerIdHash": id_hash(s.id),
        "address": s.address,
        "name": s.name,
        "bizNo": s.biz_no,
        "contact": s.contact,
        "status": s.status,
        "rejectReason": s.reject_reason,
        "createdAt": s.created_at,
    }


class SellerIn(BaseModel):
    name: str = Field(min_length=2, max_length=40)
    bizNo: str = Field(pattern=r"^\d{3}-\d{2}-\d{5}$")
    contact: str = Field(min_length=5, max_length=80)

    @field_validator("name", "bizNo", "contact", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v


@router.post("/sellers", status_code=201)
def seller_apply(body: SellerIn, user: CurrentUser = AUTH, db: Session = DB):
    exists = db.scalar(select(Seller).where(Seller.address == user.address))
    if exists and exists.status != "rejected":
        raise ApiError(409, "이미 신청한 지갑이에요.")
    if exists:
        db.delete(exists)
        db.flush()
    s = Seller(id=f"seller:{short_id()}", address=user.address, name=body.name, biz_no=body.bizNo, contact=body.contact, status="pending", created_at=now_ms())
    db.add(s)
    db.flush()
    return seller_out(s)


@router.get("/sellers/me")
def seller_me(user: CurrentUser = AUTH, db: Session = DB):
    s = db.scalar(select(Seller).where(Seller.address == user.address))
    return seller_out(s) if s else None


def approved_seller(db: Session, address: str) -> Seller:
    s = db.scalar(select(Seller).where(Seller.address == address))
    if not s or s.status != "approved":
        raise ApiError(403, "승인된 판매자만 할 수 있어요.")
    return s


class ProductIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    category: str
    option: str = Field(min_length=1, max_length=40)
    originalPrice: int = Field(gt=0)
    price: int = Field(gt=0)
    description: str = Field(default="", max_length=1000)

    @field_validator("category")
    @classmethod
    def valid_category(cls, v):
        if v not in CATEGORIES:
            raise ValueError("카테고리가 올바르지 않아요")
        return v

    @model_validator(mode="after")
    def price_le_original(self):
        if self.price > self.originalPrice:
            raise ValueError("공구가는 정가보다 클 수 없어요.")
        return self


@router.post("/products", status_code=201)
def product_create(raw: dict = Body(...), user: CurrentUser = AUTH, db: Session = DB):
    seller = approved_seller(db, user.address)
    body = validate(ProductIn, raw)
    p = Product(
        id=f"product:{short_id()}",
        kind="listed",
        seller_id=seller.id,
        name=body.name.strip(),
        category=body.category,
        option=body.option.strip(),
        original_price=body.originalPrice,
        price=body.price,
        description=body.description.strip(),
        tint=random.choice(TINTS),
        created_at=now_ms(),
    )
    db.add(p)
    db.flush()
    return product_out(p, seller.name)


@router.get("/products/mine")
def products_mine(user: CurrentUser = AUTH, db: Session = DB):
    seller = approved_seller(db, user.address)
    rows = db.scalars(select(Product).where(Product.seller_id == seller.id).order_by(Product.created_at.desc())).all()
    return [product_out(p, seller.name) for p in rows]


# ─────────────── 외부 상품 제안 (GB-02, LNK-01·02) ───────────────


def check_mall_url(raw: str) -> tuple[str, str]:
    try:
        u = urlparse(raw)
    except ValueError:
        raise ApiError(400, "링크 형식이 올바르지 않아요.")
    if not u.scheme or not u.hostname:
        raise ApiError(400, "링크 형식이 올바르지 않아요.")
    if u.scheme != "https":
        raise ApiError(400, "https 링크만 받아요.")
    host = u.hostname.removeprefix("www.")
    mall = next((d for d in ALLOWED_MALLS if host == d or host.endswith("." + d)), None)
    if not mall:
        raise ApiError(400, "허용된 쇼핑몰 링크가 아니에요. (쿠팡, 네이버 스마트스토어, 11번가)")
    return raw, ALLOWED_MALLS[mall]


class ProposalIn(BaseModel):
    url: str
    name: str = Field(min_length=2, max_length=60)
    category: str
    option: str = Field(min_length=1, max_length=40)
    currentPrice: int = Field(gt=0)
    maxPrice: int = Field(gt=0)
    targetQty: int = Field(ge=2, le=1000)
    maxPerUser: int = Field(ge=1)
    days: int = Field(ge=1, le=30)
    reason: str = Field(default="", max_length=300)

    @field_validator("category")
    @classmethod
    def valid_category(cls, v):
        if v not in CATEGORIES:
            raise ValueError("카테고리가 올바르지 않아요")
        return v

    @model_validator(mode="after")
    def check(self):
        if self.maxPerUser > self.targetQty:
            raise ValueError("1인 최대는 목표 수량 이하")
        if self.maxPrice < self.currentPrice:
            raise ValueError("최대 가격은 현재 가격 이상")
        return self


def proposal_out(pr: Proposal, p: Product) -> dict:
    return {
        "id": pr.id,
        "proposer": pr.proposer,
        "productId": pr.product_id,
        "productHash": id_hash(pr.product_id),
        "merchantId": pr.merchant_id,
        "merchantIdHash": id_hash(pr.merchant_id),
        "name": p.name,
        "category": p.category,
        "option": p.option,
        "url": p.url,
        "currentPrice": p.original_price,
        "maxPrice": pr.max_price,
        "targetQty": pr.target_qty,
        "maxPerUser": pr.max_per_user,
        "days": pr.days,
        "reason": pr.reason,
        "status": pr.status,
        "rejectReason": pr.reject_reason,
        "groupId": pr.group_id,
        "createdAt": pr.created_at,
    }


def proposals_query():
    return select(Proposal, Product).join(Product, Product.id == Proposal.product_id)


@router.post("/proposals", status_code=201)
def proposal_create(body: ProposalIn, user: CurrentUser = AUTH, db: Session = DB):
    url, merchant_id = check_mall_url(body.url)
    now = now_ms()
    p = Product(
        id=f"product:{short_id()}",
        kind="external",
        name=body.name.strip(),
        category=body.category,
        option=body.option.strip(),
        original_price=body.currentPrice,
        price=body.maxPrice,
        description=body.reason.strip(),
        url=url,
        tint=random.choice(TINTS),
        created_at=now,
    )
    pr = Proposal(
        id=f"prop_{short_id()}",
        proposer=user.address,
        product_id=p.id,
        merchant_id=merchant_id,
        max_price=body.maxPrice,
        target_qty=body.targetQty,
        max_per_user=body.maxPerUser,
        days=body.days,
        reason=body.reason.strip(),
        status="pending",
        created_at=now,
    )
    db.add_all([p, pr])
    db.flush()
    return proposal_out(pr, p)


@router.get("/proposals/mine")
def proposals_mine(user: CurrentUser = AUTH, db: Session = DB):
    rows = db.execute(proposals_query().where(Proposal.proposer == user.address).order_by(Proposal.created_at.desc())).all()
    return [proposal_out(pr, p) for pr, p in rows]


# ─────────────── 담당자 (ADM) ───────────────
# 체인 기록(판매자 등록, 외부 공구 생성)은 담당자가 자기 지갑으로 직접 보내고,
# 서버는 체인을 읽어 실제로 기록됐는지 확인한 뒤에만 상태를 바꾼다.


class ReasonIn(BaseModel):
    reason: str = Field(min_length=1, max_length=200)


@router.get("/admin/sellers")
def admin_sellers(_: CurrentUser = REVIEWER, db: Session = DB):
    rows = db.scalars(select(Seller).order_by(case((Seller.status == "pending", 0), else_=1), Seller.created_at.desc())).all()
    return [seller_out(s) for s in rows]


@router.post("/admin/sellers/{seller_id}/approve")
def admin_seller_approve(seller_id: str, _: CurrentUser = REVIEWER, db: Session = DB):
    s = db.get(Seller, seller_id)
    if not s:
        raise ApiError(404, "신청을 찾을 수 없어요.")
    chain = onchain_seller(s.id)
    if not chain["active"] or chain["wallet"].lower() != s.address.lower():
        raise ApiError(409, "컨트랙트에 판매자 지갑이 아직 등록되지 않았어요. setSeller 트랜잭션을 먼저 보내 주세요.")
    s.status, s.reject_reason = "approved", None
    return seller_out(s)


@router.post("/admin/sellers/{seller_id}/reject")
def admin_seller_reject(seller_id: str, body: ReasonIn, _: CurrentUser = REVIEWER, db: Session = DB):
    s = db.get(Seller, seller_id)
    if not s or s.status != "pending":
        raise ApiError(404, "대기 중인 신청이 아니에요.")
    s.status, s.reject_reason = "rejected", body.reason.strip()
    return {"ok": True}


@router.get("/admin/proposals")
def admin_proposals(_: CurrentUser = REVIEWER, db: Session = DB):
    rows = db.execute(proposals_query().order_by(case((Proposal.status == "pending", 0), else_=1), Proposal.created_at.desc())).all()
    return [proposal_out(pr, p) for pr, p in rows]


class ApproveProposalIn(BaseModel):
    groupId: int = Field(gt=0)


@router.post("/admin/proposals/{proposal_id}/approve")
def admin_proposal_approve(proposal_id: str, body: ApproveProposalIn, _: CurrentUser = REVIEWER, db: Session = DB):
    row = db.execute(proposals_query().where(Proposal.id == proposal_id)).first()
    if not row or row[0].status != "pending":
        raise ApiError(404, "대기 중인 제안이 아니에요.")
    pr, p = row
    g = onchain_group(body.groupId)
    ok = (
        g is not None
        and g["kind"] == 1
        and g["productHash"] == id_hash(pr.product_id)
        and g["partyId"] == id_hash(pr.merchant_id)
        and g["creator"].lower() == pr.proposer.lower()
    )
    if not ok:
        raise ApiError(409, "체인의 공구가 이 제안과 맞지 않아요. createExternalGroup 을 먼저 보내 주세요.")
    pr.status, pr.group_id = "approved", body.groupId
    return proposal_out(pr, p)


@router.post("/admin/proposals/{proposal_id}/reject")
def admin_proposal_reject(proposal_id: str, body: ReasonIn, _: CurrentUser = REVIEWER, db: Session = DB):
    pr = db.get(Proposal, proposal_id)
    if not pr or pr.status != "pending":
        raise ApiError(404, "대기 중인 제안이 아니에요.")
    pr.status, pr.reject_reason = "rejected", body.reason.strip()
    return {"ok": True}
