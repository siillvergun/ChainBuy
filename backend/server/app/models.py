"""DB 테이블 (JPA의 @Entity에 해당). 시간은 모두 밀리초 unix time (프론트·기존 API와 같은 형식)."""

from sqlalchemy import BigInteger, Boolean, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Nonce(Base):
    __tablename__ = "nonces"
    address: Mapped[str] = mapped_column(String(42), primary_key=True)
    nonce: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[int] = mapped_column(BigInteger)


class Seller(Base):
    """판매자 입점 (SEL). id = seller:xxxx, 컨트랙트 sellerId = keccak256(id)"""

    __tablename__ = "sellers"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    address: Mapped[str] = mapped_column(String(42), unique=True)
    name: Mapped[str] = mapped_column(String(40))
    biz_no: Mapped[str] = mapped_column(String(20))
    contact: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(10), default="pending")  # pending | approved | rejected
    reject_reason: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[int] = mapped_column(BigInteger)


class Product(Base):
    """상품 정보. 체인에는 productHash = keccak256(id)만 올라간다"""

    __tablename__ = "products"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    kind: Mapped[str] = mapped_column(String(10))  # listed | external
    seller_id: Mapped[str | None] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(60))
    category: Mapped[str] = mapped_column(String(20))
    option: Mapped[str] = mapped_column(String(40))
    original_price: Mapped[int] = mapped_column(Integer)
    price: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str | None] = mapped_column(Text)
    tint: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[int] = mapped_column(BigInteger)


class Proposal(Base):
    """외부 상품 공구 제안 (GB-02, LNK)"""

    __tablename__ = "proposals"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    proposer: Mapped[str] = mapped_column(String(42))
    product_id: Mapped[str] = mapped_column(String(40))
    merchant_id: Mapped[str] = mapped_column(String(40))
    max_price: Mapped[int] = mapped_column(Integer)
    target_qty: Mapped[int] = mapped_column(Integer)
    max_per_user: Mapped[int] = mapped_column(Integer)
    days: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(10), default="pending")
    reject_reason: Mapped[str | None] = mapped_column(String(200))
    group_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[int] = mapped_column(BigInteger)


class Influencer(Base):
    __tablename__ = "influencers"
    address: Mapped[str] = mapped_column(String(42), primary_key=True)
    handle: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(30))
    bio: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[int] = mapped_column(BigInteger)


class InfluencerAccount(Base):
    """OAuth로 확인한 SNS 계정. SNS 계정 하나는 인플루언서 한 명에게만 (복합 PK)"""

    __tablename__ = "influencer_accounts"
    platform: Mapped[str] = mapped_column(String(20), primary_key=True)
    platform_user_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    address: Mapped[str] = mapped_column(String(42), index=True)
    username: Mapped[str] = mapped_column(String(100))
    url: Mapped[str] = mapped_column(Text)
    verified_at: Mapped[int] = mapped_column(BigInteger)


class OAuthState(Base):
    __tablename__ = "oauth_states"
    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    address: Mapped[str] = mapped_column(String(42))
    platform: Mapped[str] = mapped_column(String(20))
    verifier: Mapped[str] = mapped_column(String(100))
    expires_at: Mapped[int] = mapped_column(BigInteger)


class GroupTag(Base):
    """공구 협찬 태그: pending | accepted | rejected | removed"""

    __tablename__ = "group_tags"
    group_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    influencer: Mapped[str] = mapped_column(String(42), primary_key=True)
    seller: Mapped[str] = mapped_column(String(42))
    status: Mapped[str] = mapped_column(String(10), default="pending")
    created_at: Mapped[int] = mapped_column(BigInteger)


class User(Base):
    """사용자 프로필·배송지. 배송지 원문은 서버에만, 체인에는 솔트 해시만"""

    __tablename__ = "users"
    address: Mapped[str] = mapped_column(String(42), primary_key=True)
    nickname: Mapped[str] = mapped_column(String(20), default="")
    contact: Mapped[str] = mapped_column(String(80), default="")
    ship_name: Mapped[str | None] = mapped_column(String(20))
    ship_phone: Mapped[str | None] = mapped_column(String(14))
    ship_zip: Mapped[str | None] = mapped_column(String(5))
    ship_addr1: Mapped[str | None] = mapped_column(String(100))
    ship_addr2: Mapped[str | None] = mapped_column(String(60))
    salt: Mapped[str] = mapped_column(String(32))
    updated_at: Mapped[int] = mapped_column(BigInteger)


class Like(Base):
    __tablename__ = "likes"
    address: Mapped[str] = mapped_column(String(42), primary_key=True)
    group_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[int] = mapped_column(BigInteger)

    __table_args__ = (Index("likes_group", "group_id"),)


class Shipment(Base):
    """공구 배송 (운송장). 입점 상품은 판매자가 등록, 외부 상품은 에이전트가 주문 후 등록"""

    __tablename__ = "shipments"
    group_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tracking_no: Mapped[str] = mapped_column(String(40))
    carrier: Mapped[str] = mapped_column(String(20), default="mock")
    registered_by: Mapped[str] = mapped_column(String(42))  # 판매자 지갑 또는 'agent'
    order_id: Mapped[str | None] = mapped_column(String(60))  # 외부 상품: 쇼핑몰 주문번호
    created_at: Mapped[int] = mapped_column(BigInteger)


class AgentLog(Base):
    """에이전트 활동 기록 (담당자 확인·공구 진행 기록 표시용)"""

    __tablename__ = "agent_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(Integer, index=True)
    action: Mapped[str] = mapped_column(String(30))  # finalize | check | cancel | pay | fund_card | order | proof | shipped | fee | error
    message: Mapped[str] = mapped_column(Text)
    detail: Mapped[str | None] = mapped_column(Text)  # JSON (AI 확인 결과 등)
    tx_hash: Mapped[str | None] = mapped_column(String(66))
    created_at: Mapped[int] = mapped_column(BigInteger)


class SmartAccount(Base):
    """참여자 스마트 지갑(ERC-4337) ↔ 주인 MetaMask 주소. 체인에는 스마트 지갑 주소로 참여 기록이 남으므로
    판매자 배송지 목록처럼 사용자 정보를 붙일 때 주인 주소로 되찾는다"""

    __tablename__ = "smart_accounts"
    account: Mapped[str] = mapped_column(String(42), primary_key=True)
    owner: Mapped[str] = mapped_column(String(42), unique=True)
    created_at: Mapped[int] = mapped_column(BigInteger)


class SponsoredOperation(Base):
    """플랫폼이 가스비를 대신 낸 요청(UserOperation) 기록. 하루 횟수 제한에 쓴다"""

    __tablename__ = "sponsored_operations"
    user_op_hash: Mapped[str] = mapped_column(String(66), primary_key=True)
    account: Mapped[str] = mapped_column(String(42), index=True)
    tx_hash: Mapped[str] = mapped_column(String(66))
    success: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[int] = mapped_column(BigInteger, index=True)
