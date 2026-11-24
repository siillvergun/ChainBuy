"""지갑 서명 로그인 + JWT

1) POST /auth/nonce {address} → 서명할 문구 (nonce는 5분, 1회용)
2) 지갑으로 서명 → POST /auth/verify {address, signature} → JWT(HS256, 12시간)
3) 이후 요청은 Authorization: Bearer <JWT>

Spring Security로 치면 current_user 의존성이 인증 필터, require_reviewer가 권한 검사다.
"""

import secrets
import time

import jwt
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import is_address, to_checksum_address
from fastapi import Depends, Header
from sqlalchemy.orm import Session

from .chain import is_reviewer
from .config import settings
from .db import get_db
from .errors import ApiError
from .models import Nonce

NONCE_TTL_MS = 5 * 60 * 1000


def now_ms() -> int:
    return int(time.time() * 1000)


def login_message(address: str, nonce: str) -> str:
    return f"ChainBuy에 로그인합니다.\n\n지갑: {address}\nnonce: {nonce}\n\n이 서명은 거래가 아니며 수수료가 들지 않습니다."


def checksum(raw: str) -> str:
    if not raw or not is_address(raw):
        raise ApiError(400, "지갑 주소가 올바르지 않아요.")
    return to_checksum_address(raw)


def issue_nonce(db: Session, raw: str) -> dict:
    address = checksum(raw)
    nonce = secrets.token_hex(16)
    db.merge(Nonce(address=address, nonce=nonce, expires_at=now_ms() + NONCE_TTL_MS))
    return {"address": address, "message": login_message(address, nonce)}


def verify_login(db: Session, raw: str, signature: str) -> dict:
    address = checksum(raw)
    row = db.get(Nonce, address)
    if not row or row.expires_at < now_ms():
        raise ApiError(401, "로그인 요청이 만료됐어요. 다시 시도해 주세요.")
    try:
        signer = Account.recover_message(encode_defunct(text=login_message(address, row.nonce)), signature=signature)
    except Exception:
        raise ApiError(401, "서명이 지갑 주소와 맞지 않아요.")
    if signer != address:
        raise ApiError(401, "서명이 지갑 주소와 맞지 않아요.")
    db.delete(row)  # 같은 서명 재사용 방지

    s = settings()
    exp = int(time.time()) + s.jwt_ttl_seconds
    token = jwt.encode({"sub": address, "iat": int(time.time()), "exp": exp}, s.jwt_secret, algorithm="HS256")
    return {"token": token, "address": address, "expiresAt": exp * 1000, "isReviewer": is_reviewer(address)}


class CurrentUser:
    def __init__(self, address: str, expires_at: int):
        self.address = address
        self.expires_at = expires_at


def current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    """Authorization: Bearer <JWT> 를 검증해서 지갑 주소를 꺼낸다"""
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        raise ApiError(401, "지갑으로 로그인해 주세요.")
    try:
        claims = jwt.decode(token, settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise ApiError(401, "로그인이 만료됐어요. 다시 로그인해 주세요.")
    return CurrentUser(address=claims["sub"], expires_at=claims["exp"] * 1000)


def require_reviewer(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    if not is_reviewer(user.address):
        raise ApiError(403, "담당자만 할 수 있어요.")
    return user


DB = Depends(get_db)
AUTH = Depends(current_user)
REVIEWER = Depends(require_reviewer)
