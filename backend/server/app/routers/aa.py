"""계정 추상화 API: 내 스마트 지갑 · 가스비 대납 요청 만들기 · 서명한 요청 제출

로그인은 지금처럼 MetaMask 주소(주인)로 하고, 체인에서 참여하는 주체는 그 주소가 주인인 스마트 지갑이다.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import account_abstraction as aa
from ..auth import AUTH, DB, CurrentUser, now_ms
from ..db import CommitRoute
from ..errors import ApiError
from ..models import SmartAccount, SponsoredOperation

router = APIRouter(route_class=CommitRoute)

DAY_MS = 24 * 60 * 60 * 1000


def remember_account(db: Session, owner: str, account: str) -> None:
    """스마트 지갑 ↔ 주인 주소를 저장한다 (판매자 배송지 목록에서 참여자를 찾을 때 쓴다)"""
    if not db.get(SmartAccount, account):
        db.add(SmartAccount(account=account, owner=owner, created_at=now_ms()))


@router.get("/aa/account", summary="내 스마트 지갑 주소")
def my_account(user: CurrentUser = AUTH, db: Session = DB):
    """MetaMask 주소가 주인인 스마트 지갑 주소. 아직 체인에 만들어지지 않았으면 deployed=false (첫 거래 때 함께 만들어진다)"""
    account = aa.account_of(user.address)
    remember_account(db, user.address, account)
    return {"owner": user.address, "account": account, "deployed": aa.is_deployed(account)}


class PrepareIn(BaseModel):
    callData: str = Field(pattern=r"^0x[0-9a-fA-F]{8,}$", description="스마트 지갑 execute / executeBatch 호출 데이터")


def sponsored_today(db: Session, account: str) -> int:
    since = now_ms() - DAY_MS
    return db.scalar(
        select(func.count()).select_from(SponsoredOperation).where(SponsoredOperation.account == account, SponsoredOperation.created_at >= since)
    )


def require_quota(db: Session, account: str) -> None:
    limit = aa.settings().sponsored_operations_per_day
    if sponsored_today(db, account) >= limit:
        raise ApiError(429, f"가스비 대납은 하루 {limit}번까지예요. 내일 다시 시도해 주세요.")


@router.post("/aa/prepare", summary="가스비 대납 요청 만들기")
def prepare(body: PrepareIn, user: CurrentUser = AUTH, db: Session = DB):
    """서명할 UserOperation을 만든다. 응답의 userOpHash를 MetaMask로 서명해 /aa/send로 보낸다"""
    account = aa.account_of(user.address)
    remember_account(db, user.address, account)
    require_quota(db, account)
    return aa.prepare(user.address, bytes.fromhex(body.callData[2:]))


class SendIn(BaseModel):
    userOp: dict = Field(description="/aa/prepare가 준 userOp에 사용자 서명(signature)을 넣은 것")


@router.post("/aa/send", summary="서명한 요청 제출")
def send(body: SendIn, user: CurrentUser = AUTH, db: Session = DB):
    """사용자가 서명한 UserOperation을 EntryPoint에 제출한다 (서버가 번들러 역할, 가스비는 Paymaster)"""
    op = aa.from_json(body.userOp)
    h = aa.verify_owner_signature(user.address, op)
    require_quota(db, op["sender"])
    aa.check_sponsored_calls(op["sender"], op["callData"])

    result = aa.submit(op, h)
    db.add(SponsoredOperation(user_op_hash="0x" + h.hex(), account=op["sender"], tx_hash=result["txHash"], success=result["success"], created_at=now_ms()))
    if not result["success"]:
        db.commit()  # 실패도 횟수에 넣는다 (아래 예외로 롤백되기 전에 저장)
        raise ApiError(400, f"체인에서 거절됐어요: {result['reason'] or '알 수 없는 오류'}")
    return result
