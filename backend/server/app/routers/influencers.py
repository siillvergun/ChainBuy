"""인플루언서 (INF): 프로필 · SNS 계정 OAuth 인증 · 공구 협찬 태그

- 인플루언서는 지갑으로 로그인해 프로필을 만들고, SNS 계정을 OAuth로 연결해 '인증된 인플루언서'가 된다.
- 판매자는 자기 공구에 인증된 인플루언서를 태그하고, 인플루언서가 수락해야 협찬 배지가 공개된다.
"""

import html
import re
import secrets
import traceback
from urllib.parse import urlencode

from fastapi import APIRouter, Query

from ..db import CommitRoute
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..auth import AUTH, DB, CurrentUser, now_ms
from ..chain import id_hash, onchain_group
from ..config import settings
from ..errors import ApiError
from ..models import GroupTag, Influencer, InfluencerAccount, OAuthState, Seller
from ..oauth_providers import PROVIDERS

router = APIRouter(route_class=CommitRoute)

STATE_TTL_MS = 10 * 60 * 1000


def accounts_of(db: Session, address: str) -> list[dict]:
    rows = db.scalars(select(InfluencerAccount).where(InfluencerAccount.address == address).order_by(InfluencerAccount.verified_at)).all()
    return [
        {"platform": a.platform, "label": PROVIDERS[a.platform].label if a.platform in PROVIDERS else a.platform, "username": a.username, "url": a.url, "verifiedAt": a.verified_at}
        for a in rows
    ]


def profile_out(db: Session, p: Influencer) -> dict:
    accounts = accounts_of(db, p.address)
    return {"address": p.address, "handle": p.handle, "name": p.name, "bio": p.bio, "verified": len(accounts) > 0, "accounts": accounts}


# ─────────────── 프로필 ───────────────


class ProfileIn(BaseModel):
    handle: str = Field(description="핸들 (영문 소문자·숫자·_·. 3~20자)")
    name: str = Field(min_length=1, max_length=30, description="표시 이름")
    bio: str = Field(default="", max_length=200, description="소개")

    @field_validator("handle", mode="before")
    @classmethod
    def norm_handle(cls, v):
        v = str(v).strip().lower()
        if not re.fullmatch(r"[a-z0-9_.]{3,20}", v):
            raise ValueError("핸들은 영문 소문자·숫자·_·. 3~20자")
        return v


@router.post("/influencers", summary="인플루언서 프로필 저장")
def influencer_save(body: ProfileIn, user: CurrentUser = AUTH, db: Session = DB):
    """없으면 만들고 있으면 수정한다. 핸들은 다른 사람과 겹칠 수 없다"""
    taken = db.scalar(select(Influencer).where(Influencer.handle == body.handle))
    if taken and taken.address != user.address:
        raise ApiError(409, "이미 쓰고 있는 핸들이에요.")
    p = db.get(Influencer, user.address)
    if p:
        p.handle, p.name, p.bio = body.handle, body.name.strip(), body.bio.strip()
    else:
        p = Influencer(address=user.address, handle=body.handle, name=body.name.strip(), bio=body.bio.strip(), created_at=now_ms())
        db.add(p)
    db.flush()
    return profile_out(db, p)


@router.get("/influencers/me", summary="내 인플루언서 프로필")
def influencer_me(user: CurrentUser = AUTH, db: Session = DB):
    """연결한 SNS 계정과 받은 협찬 태그를 함께 돌려준다. 프로필이 없으면 null"""
    p = db.get(Influencer, user.address)
    if not p:
        return None
    tags = db.scalars(select(GroupTag).where(GroupTag.influencer == user.address).order_by(GroupTag.created_at.desc())).all()
    return {
        **profile_out(db, p),
        "tags": [{"groupId": t.group_id, "seller": t.seller, "status": t.status, "createdAt": t.created_at} for t in tags],
    }


@router.get("/influencers", summary="인증된 인플루언서 목록")
def influencers(db: Session = DB):
    """판매자가 태그할 때 고르는 목록: 인증된 인플루언서만"""
    rows = db.scalars(select(Influencer).order_by(Influencer.handle)).all()
    return [x for x in (profile_out(db, p) for p in rows) if x["verified"]]


@router.get("/influencers/{handle}", summary="인플루언서 공개 프로필")
def influencer_public(handle: str, db: Session = DB):
    """수락한 협찬 공구 번호 목록을 함께 돌려준다"""
    p = db.scalar(select(Influencer).where(Influencer.handle == handle.lower()))
    if not p:
        raise ApiError(404, "인플루언서를 찾을 수 없어요.")
    ids = db.scalars(
        select(GroupTag.group_id).where(GroupTag.influencer == p.address, GroupTag.status == "accepted").order_by(GroupTag.group_id.desc())
    ).all()
    return {**profile_out(db, p), "groupIds": list(ids)}


@router.delete("/influencers/me/accounts/{platform}", summary="SNS 계정 연결 해제")
def influencer_unlink(platform: str, user: CurrentUser = AUTH, db: Session = DB):
    """연결한 계정이 하나도 없으면 인증 배지가 사라진다"""
    db.execute(delete(InfluencerAccount).where(InfluencerAccount.address == user.address, InfluencerAccount.platform == platform))
    p = db.get(Influencer, user.address)
    if not p:
        raise ApiError(404, "인플루언서 프로필이 없어요.")
    return profile_out(db, p)


# ─────────────── 공구 협찬 태그 ───────────────


class TagIn(BaseModel):
    handle: str = Field(description="태그할 인플루언서 핸들 (@ 생략 가능)")

    @field_validator("handle", mode="before")
    @classmethod
    def norm(cls, v):
        return str(v).strip().lower().removeprefix("@")


@router.post("/groups/{group_id}/tags", summary="공구에 인플루언서 태그", status_code=201)
def tag_create(group_id: int, body: TagIn, user: CurrentUser = AUTH, db: Session = DB):
    """판매자가 자기 공구에 인증된 인플루언서를 태그한다 (수락 전에는 비공개)"""
    seller = db.scalar(select(Seller).where(Seller.address == user.address, Seller.status == "approved"))
    if not seller:
        raise ApiError(403, "승인된 판매자만 태그할 수 있어요.")
    g = onchain_group(group_id)
    if not g or g["kind"] != 0 or g["partyId"] != id_hash(seller.id):
        raise ApiError(403, "내가 연 공구에만 태그할 수 있어요.")
    inf = db.scalar(select(Influencer).where(Influencer.handle == body.handle))
    if not inf:
        raise ApiError(404, f"@{body.handle} 인플루언서를 찾을 수 없어요.")
    if not accounts_of(db, inf.address):
        raise ApiError(409, "SNS 계정 인증을 마친 인플루언서만 태그할 수 있어요.")
    t = db.get(GroupTag, (group_id, inf.address))
    if t:
        t.status, t.seller = "pending", user.address
    else:
        db.add(GroupTag(group_id=group_id, influencer=inf.address, seller=user.address, status="pending", created_at=now_ms()))
    return {"groupId": group_id, "handle": body.handle, "status": "pending"}


class RespondIn(BaseModel):
    action: str = Field(description="accept(수락) · reject(거절) · remove(수락했던 태그 내리기)")

    @field_validator("action")
    @classmethod
    def valid(cls, v):
        if v not in ("accept", "reject", "remove"):
            raise ValueError("accept · reject · remove 중 하나")
        return v


@router.post("/tags/{group_id}/respond", summary="협찬 태그 수락·거절·내리기")
def tag_respond(group_id: int, body: RespondIn, user: CurrentUser = AUTH, db: Session = DB):
    """인플루언서가 태그를 수락·거절하거나, 수락했던 태그를 내린다"""
    t = db.get(GroupTag, (group_id, user.address))
    if not t:
        raise ApiError(404, "받은 태그가 아니에요.")
    t.status = {"accept": "accepted", "reject": "rejected", "remove": "removed"}[body.action]
    return {"groupId": group_id, "status": t.status}


@router.get("/tags", summary="공개된 협찬 태그 전체")
def tags_public(db: Session = DB):
    """공개된(수락된) 협찬 태그 전체 — 공구 카드·상세의 배지용"""
    rows = db.execute(
        select(GroupTag.group_id, Influencer)
        .join(Influencer, Influencer.address == GroupTag.influencer)
        .where(GroupTag.status == "accepted")
        .order_by(GroupTag.group_id)
    ).all()
    return [{"groupId": gid, "handle": p.handle, "name": p.name, "platforms": [a["label"] for a in accounts_of(db, p.address)]} for gid, p in rows]


# ─────────────── OAuth: SNS 계정 소유 확인 ───────────────


@router.get("/oauth/providers", summary="연결 가능한 SNS 목록")
def oauth_providers():
    """설정이 안 된 플랫폼은 enabled=false"""
    return [{"platform": k, "label": v.label, "enabled": v.enabled()} for k, v in PROVIDERS.items() if k != "mock" or v.enabled()]


@router.post("/oauth/{platform}/start", summary="SNS 계정 연결 시작")
def oauth_start(platform: str, user: CurrentUser = AUTH, db: Session = DB):
    """응답의 url로 이동해 SNS 로그인을 하면 /oauth/{platform}/callback으로 돌아온다"""
    provider = PROVIDERS.get(platform)
    if not provider:
        raise ApiError(404, "지원하지 않는 플랫폼이에요.")
    if not provider.enabled():
        raise ApiError(503, f"{provider.label} 연동이 아직 설정되지 않았어요.")
    if not db.get(Influencer, user.address):
        raise ApiError(409, "인플루언서 프로필을 먼저 만들어 주세요.")
    state = secrets.token_hex(16)
    verifier = secrets.token_urlsafe(32)
    db.add(OAuthState(state=state, address=user.address, platform=platform, verifier=verifier, expires_at=now_ms() + STATE_TTL_MS))
    return {"url": provider.authorize_url(state, verifier)}


def _back(**params: str) -> RedirectResponse:
    return RedirectResponse(f"{settings().web_origin}/influencer?{urlencode(params)}", status_code=302)


@router.get("/oauth/mock/authorize", summary="테스트용 SNS 로그인 화면", response_class=HTMLResponse)
def oauth_mock_authorize(state: str = ""):
    """개발용 가짜 SNS 로그인 화면"""
    if not PROVIDERS["mock"].enabled():
        raise ApiError(404, "Not Found")
    st = html.escape(re.sub(r"[^a-f0-9]", "", state))
    return f"""<!doctype html><meta charset="utf-8"><title>테스트 SNS 로그인</title>
<body style="font-family:sans-serif;max-width:360px;margin:80px auto">
<h2>테스트 SNS 로그인</h2><p style="color:#666">개발용 화면이에요. 실제 SNS 대신 사용자명을 입력해 계정 소유 확인을 흉내 내요.</p>
<form action="/oauth/mock/callback" method="get">
<input type="hidden" name="state" value="{st}">
<input name="code" placeholder="사용자명 (예: coffee_lover)" required style="width:100%;padding:10px;margin:8px 0">
<button style="width:100%;padding:10px">이 계정으로 로그인</button></form></body>"""


@router.get("/oauth/{platform}/callback", summary="SNS 로그인 결과 처리")
def oauth_callback(platform: str, state: str = "", code: str = "", error: str | None = Query(default=None), db: Session = DB):
    """SNS가 호출하는 주소. 계정을 연결하고 프론트 /influencer 화면으로 돌려보낸다"""
    row = db.get(OAuthState, state) if state else None
    # state는 한 번만 쓰고, 만료된 것들도 같이 정리
    db.execute(delete(OAuthState).where((OAuthState.state == state) | (OAuthState.expires_at < now_ms())))
    db.commit()
    if not row or row.platform != platform or row.expires_at < now_ms():
        return _back(error="인증 요청이 만료됐어요. 다시 시도해 주세요.")
    if error or not code:
        return _back(error="SNS 로그인을 취소했어요.")
    try:
        acc = PROVIDERS[platform].exchange(code, row.verifier)
    except Exception as e:
        traceback.print_exception(e)
        return _back(error=str(e) or "계정 확인에 실패했어요.")
    owner = db.get(InfluencerAccount, (platform, acc.platform_user_id))
    if owner and owner.address != row.address:
        return _back(error="이 SNS 계정은 이미 다른 인플루언서에게 연결돼 있어요.")
    # 플랫폼당 계정 하나
    db.execute(delete(InfluencerAccount).where(InfluencerAccount.address == row.address, InfluencerAccount.platform == platform))
    db.add(InfluencerAccount(platform=platform, platform_user_id=acc.platform_user_id, address=row.address, username=acc.username, url=acc.url, verified_at=now_ms()))
    return _back(linked=platform)

