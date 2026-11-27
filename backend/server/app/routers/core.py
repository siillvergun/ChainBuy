"""로그인 · 상품 · 판매자 입점 · 외부 상품 제안 · 담당자 API"""

import random
import secrets
from urllib.parse import urlparse

from fastapi import APIRouter, Body

from ..db import CommitRoute
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from sqlalchemy import case, select
from sqlalchemy.orm import Session

from ..auth import AUTH, DB, REVIEWER, SELLER_MANAGER, CurrentUser, issue_nonce, now_ms, verify_login
from ..chain import id_hash, is_reviewer, is_seller_manager, onchain_group, onchain_seller
from ..config import ALLOWED_MALLS, CATEGORIES
from ..errors import ApiError
from ..models import AgentLog, Product, Proposal, Seller

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


@router.get("/health", summary="서버 상태 확인")
def health():
    """서버가 살아 있으면 {ok: true}"""
    return {"ok": True}


class NonceIn(BaseModel):
    address: str = Field(default="", description="로그인할 지갑 주소")


@router.post("/auth/nonce", summary="로그인용 nonce 발급")
def auth_nonce(body: NonceIn, db: Session = DB):
    """지갑으로 서명할 일회용 메시지를 만든다. 받은 message를 MetaMask로 서명해 /auth/verify로 보낸다"""
    return issue_nonce(db, body.address)


class VerifyIn(BaseModel):
    address: str = Field(description="로그인할 지갑 주소")
    signature: str = Field(pattern=r"^0x[0-9a-fA-F]+$", description="nonce 메시지에 대한 지갑 서명")


@router.post("/auth/verify", summary="서명 검증 후 토큰 발급")
def auth_verify(body: VerifyIn, db: Session = DB):
    """nonce 메시지 서명이 그 지갑의 것인지 확인하고 Bearer 토큰을 준다. 응답에 공구 담당자·입점 담당자 여부가 포함된다"""
    return verify_login(db, body.address, body.signature)


@router.get("/auth/me", summary="내 로그인 정보")
def auth_me(user: CurrentUser = AUTH):
    """저장해 둔 토큰이 아직 유효한지 확인 (만료 감지)"""
    return {
        "address": user.address,
        "expiresAt": user.expires_at,
        "isReviewer": is_reviewer(user.address),
        "isSellerManager": is_seller_manager(user.address),
    }


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


@router.get("/products", summary="상품 목록")
def products(db: Session = DB):
    """입점 상품과 외부 상품을 최신 순으로 돌려준다. 로그인 없이 볼 수 있다"""
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
    name: str = Field(min_length=2, max_length=40, description="상호")
    bizNo: str = Field(pattern=r"^\d{3}-\d{2}-\d{5}$", description="사업자등록번호 (000-00-00000)")
    contact: str = Field(min_length=5, max_length=80, description="연락처 (전화번호 또는 이메일)")

    @field_validator("name", "bizNo", "contact", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v


@router.post("/sellers", summary="판매자 입점 신청", status_code=201)
def seller_apply(body: SellerIn, user: CurrentUser = AUTH, db: Session = DB):
    """로그인한 지갑으로 입점을 신청한다. 반려된 신청은 다시 낼 수 있다. 승인은 입점 담당자가 한다"""
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


@router.get("/sellers/me", summary="내 입점 신청 상태")
def seller_me(user: CurrentUser = AUTH, db: Session = DB):
    """신청 내역이 없으면 null"""
    s = db.scalar(select(Seller).where(Seller.address == user.address))
    return seller_out(s) if s else None


def approved_seller(db: Session, address: str) -> Seller:
    s = db.scalar(select(Seller).where(Seller.address == address))
    if not s or s.status != "approved":
        raise ApiError(403, "승인된 판매자만 할 수 있어요.")
    return s


class ProductIn(BaseModel):
    name: str = Field(min_length=2, max_length=60, description="상품명")
    category: str = Field(description="카테고리 (config.CATEGORIES 중 하나)")
    option: str = Field(min_length=1, max_length=40, description="옵션 (예: 200g, 블랙)")
    originalPrice: int = Field(gt=0, description="정가 (원)")
    price: int = Field(gt=0, description="공구가 (원, 정가 이하)")
    description: str = Field(default="", max_length=1000, description="상품 설명")

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


@router.post("/products", summary="상품 등록", status_code=201)
def product_create(raw: dict = Body(...), user: CurrentUser = AUTH, db: Session = DB):
    """승인된 판매자만 등록할 수 있다. 공구가는 정가 이하여야 한다"""
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


@router.get("/products/mine", summary="내가 등록한 상품")
def products_mine(user: CurrentUser = AUTH, db: Session = DB):
    """승인된 판매자 전용"""
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
    url: str = Field(description="상품 링크 (쿠팡·네이버 스마트스토어·11번가 https)")
    name: str = Field(min_length=2, max_length=60, description="상품명")
    category: str = Field(description="카테고리 (config.CATEGORIES 중 하나)")
    option: str = Field(min_length=1, max_length=40, description="옵션")
    currentPrice: int = Field(gt=0, description="지금 쇼핑몰 가격 (원)")
    maxPrice: int = Field(gt=0, description="이 가격을 넘으면 결제하지 않는 상한 (원)")
    targetQty: int = Field(ge=2, le=1000, description="목표 수량")
    maxPerUser: int = Field(ge=1, description="1인 최대 수량")
    days: int = Field(ge=1, le=30, description="모집 기간 (일)")
    reason: str = Field(default="", max_length=300, description="제안 이유")

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


@router.post("/proposals", summary="외부 상품 공구 제안", status_code=201)
def proposal_create(body: ProposalIn, user: CurrentUser = AUTH, db: Session = DB):
    """쿠팡·네이버 스마트스토어·11번가 https 링크만 받는다. 공구 담당자가 검토 후 체인에 공구를 연다"""
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


@router.get("/proposals/mine", summary="내 공구 제안 목록")
def proposals_mine(user: CurrentUser = AUTH, db: Session = DB):
    """내가 낸 제안과 검토 상태(대기·승인·반려)를 최신 순으로 돌려준다"""
    rows = db.execute(proposals_query().where(Proposal.proposer == user.address).order_by(Proposal.created_at.desc())).all()
    return [proposal_out(pr, p) for pr, p in rows]


# ─────────────── 담당자 (ADM) ───────────────
# 체인 기록(판매자 등록, 외부 공구 생성)은 담당자가 자기 지갑으로 직접 보내고,
# 서버는 체인을 읽어 실제로 기록됐는지 확인한 뒤에만 상태를 바꾼다.


class ReasonIn(BaseModel):
    reason: str = Field(min_length=1, max_length=200, description="반려 사유")


@router.get("/admin/sellers", summary="입점 신청 목록 (입점 담당자)")
def admin_sellers(_: CurrentUser = SELLER_MANAGER, db: Session = DB):
    """대기 중인 신청이 먼저 나온다"""
    rows = db.scalars(select(Seller).order_by(case((Seller.status == "pending", 0), else_=1), Seller.created_at.desc())).all()
    return [seller_out(s) for s in rows]


@router.post("/admin/sellers/{seller_id}/approve", summary="입점 승인 (입점 담당자)")
def admin_seller_approve(seller_id: str, _: CurrentUser = SELLER_MANAGER, db: Session = DB):
    """입점 담당자가 자기 지갑으로 setSeller 트랜잭션을 먼저 보내야 한다. 서버는 체인에 등록됐는지 확인한 뒤에만 승인 처리한다"""
    s = db.get(Seller, seller_id)
    if not s:
        raise ApiError(404, "신청을 찾을 수 없어요.")
    chain = onchain_seller(s.id)
    if not chain["active"] or chain["wallet"].lower() != s.address.lower():
        raise ApiError(409, "컨트랙트에 판매자 지갑이 아직 등록되지 않았어요. setSeller 트랜잭션을 먼저 보내 주세요.")
    s.status, s.reject_reason = "approved", None
    return seller_out(s)


@router.post("/admin/sellers/{seller_id}/reject", summary="입점 반려 (입점 담당자)")
def admin_seller_reject(seller_id: str, body: ReasonIn, _: CurrentUser = SELLER_MANAGER, db: Session = DB):
    """대기 중인 신청만 반려할 수 있다"""
    s = db.get(Seller, seller_id)
    if not s or s.status != "pending":
        raise ApiError(404, "대기 중인 신청이 아니에요.")
    s.status, s.reject_reason = "rejected", body.reason.strip()
    return {"ok": True}


@router.get("/admin/proposals", summary="공구 제안 목록 (공구 담당자)")
def admin_proposals(_: CurrentUser = REVIEWER, db: Session = DB):
    """대기 중인 제안이 먼저 나온다"""
    rows = db.execute(proposals_query().order_by(case((Proposal.status == "pending", 0), else_=1), Proposal.created_at.desc())).all()
    return [proposal_out(pr, p) for pr, p in rows]


class ApproveProposalIn(BaseModel):
    groupId: int = Field(gt=0, description="createExternalGroup으로 체인에 만든 공구 번호")


@router.post("/admin/proposals/{proposal_id}/approve", summary="공구 제안 승인 (공구 담당자)")
def admin_proposal_approve(proposal_id: str, body: ApproveProposalIn, _: CurrentUser = REVIEWER, db: Session = DB):
    """공구 담당자가 createExternalGroup 트랜잭션을 먼저 보내야 한다. 체인의 공구가 제안 내용(상품·쇼핑몰·제안자)과 같을 때만 승인된다"""
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


@router.post("/admin/proposals/{proposal_id}/reject", summary="공구 제안 반려 (공구 담당자)")
def admin_proposal_reject(proposal_id: str, body: ReasonIn, _: CurrentUser = REVIEWER, db: Session = DB):
    """대기 중인 제안만 반려할 수 있다"""
    pr = db.get(Proposal, proposal_id)
    if not pr or pr.status != "pending":
        raise ApiError(404, "대기 중인 제안이 아니에요.")
    pr.status, pr.reject_reason = "rejected", body.reason.strip()
    return {"ok": True}


# ─────────────── 진행 기록 (에이전트 활동) ───────────────


@router.get("/groups/{group_id}/activity", summary="공구 진행 기록")
def group_activity(group_id: int, db: Session = DB):
    """에이전트가 이 공구에 한 일 (상품 확인 결과·결제·주문·배송·수수료). 최신 순"""
    import json as _json

    rows = db.scalars(select(AgentLog).where(AgentLog.group_id == group_id).order_by(AgentLog.id.desc()).limit(50)).all()
    return [
        {"action": r.action, "message": r.message, "detail": _json.loads(r.detail) if r.detail else None, "txHash": r.tx_hash, "createdAt": r.created_at}
        for r in rows
    ]
