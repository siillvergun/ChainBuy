"""SNS 계정 소유 확인용 OAuth 제공자 (YouTube · Instagram · Threads · TikTok + 개발용 mock)

각 제공자는 '로그인 화면 주소 만들기'와 '코드 → 계정 ID·사용자명' 두 가지만 한다.
받은 액세스 토큰은 계정 조회에 한 번 쓰고 저장하지 않는다. 앱 키가 있는 제공자만 켜진다.
"""

import base64
import hashlib
import re
from dataclasses import dataclass
from typing import Callable
from urllib.parse import urlencode

import httpx

from .config import settings


@dataclass
class Account:
    platform_user_id: str
    username: str
    url: str


@dataclass
class Provider:
    label: str
    enabled: Callable[[], bool]
    authorize_url: Callable[[str, str], str]
    exchange: Callable[[str, str], Account]


def redirect_uri(platform: str) -> str:
    return f"{settings().api_public_url}/oauth/{platform}/callback"


def pkce_challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def _json(res: httpx.Response, what: str) -> dict:
    try:
        body = res.json()
    except ValueError:
        body = None
    if res.status_code >= 400:
        raise RuntimeError(f"{what} 실패 ({res.status_code}): {str(body)[:200]}")
    return body


# ── YouTube: Google OAuth(PKCE) → 내 채널 ──
def _yt_url(state: str, verifier: str) -> str:
    s = settings()
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
        {
            "client_id": s.google_client_id,
            "redirect_uri": redirect_uri("youtube"),
            "response_type": "code",
            "scope": "https://www.googleapis.com/auth/youtube.readonly",
            "state": state,
            "code_challenge": pkce_challenge(verifier),
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
    )


def _yt_exchange(code: str, verifier: str) -> Account:
    s = settings()
    tok = _json(
        httpx.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": s.google_client_id,
                "client_secret": s.google_client_secret,
                "redirect_uri": redirect_uri("youtube"),
                "grant_type": "authorization_code",
                "code_verifier": verifier,
            },
        ),
        "구글 토큰 교환",
    )
    ch = _json(
        httpx.get("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", headers={"authorization": f"Bearer {tok['access_token']}"}),
        "유튜브 채널 조회",
    )
    items = ch.get("items") or []
    if not items:
        raise RuntimeError("이 구글 계정에 유튜브 채널이 없어요.")
    item = items[0]
    handle = item["snippet"].get("customUrl")
    return Account(item["id"], handle or item["snippet"]["title"], f"https://www.youtube.com/{handle}" if handle else f"https://www.youtube.com/channel/{item['id']}")


# ── Instagram: Instagram Login (프로페셔널 계정) ──
def _ig_url(state: str, _: str) -> str:
    s = settings()
    return "https://www.instagram.com/oauth/authorize?" + urlencode(
        {"client_id": s.instagram_client_id, "redirect_uri": redirect_uri("instagram"), "response_type": "code", "scope": "instagram_business_basic", "state": state}
    )


def _ig_exchange(code: str, _: str) -> Account:
    s = settings()
    tok = _json(
        httpx.post(
            "https://api.instagram.com/oauth/access_token",
            data={
                "client_id": s.instagram_client_id,
                "client_secret": s.instagram_client_secret,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri("instagram"),
                "code": code,
            },
        ),
        "인스타그램 토큰 교환",
    )
    me = _json(httpx.get("https://graph.instagram.com/me", params={"fields": "user_id,username", "access_token": tok["access_token"]}), "인스타그램 계정 조회")
    return Account(str(me.get("user_id") or me.get("id")), f"@{me['username']}", f"https://www.instagram.com/{me['username']}")


# ── Threads ──
def _th_url(state: str, _: str) -> str:
    s = settings()
    return "https://threads.net/oauth/authorize?" + urlencode(
        {"client_id": s.threads_client_id, "redirect_uri": redirect_uri("threads"), "response_type": "code", "scope": "threads_basic", "state": state}
    )


def _th_exchange(code: str, _: str) -> Account:
    s = settings()
    tok = _json(
        httpx.post(
            "https://graph.threads.net/oauth/access_token",
            data={
                "client_id": s.threads_client_id,
                "client_secret": s.threads_client_secret,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri("threads"),
                "code": code,
            },
        ),
        "스레드 토큰 교환",
    )
    me = _json(httpx.get("https://graph.threads.net/v1.0/me", params={"fields": "id,username", "access_token": tok["access_token"]}), "스레드 계정 조회")
    return Account(str(me["id"]), f"@{me['username']}", f"https://www.threads.net/@{me['username']}")


# ── TikTok: Login Kit (PKCE, 사용자명은 user.info.profile) ──
def _tt_url(state: str, verifier: str) -> str:
    s = settings()
    return "https://www.tiktok.com/v2/auth/authorize/?" + urlencode(
        {
            "client_key": s.tiktok_client_key,
            "redirect_uri": redirect_uri("tiktok"),
            "response_type": "code",
            "scope": "user.info.basic,user.info.profile",
            "state": state,
            "code_challenge": pkce_challenge(verifier),
            "code_challenge_method": "S256",
        }
    )


def _tt_exchange(code: str, verifier: str) -> Account:
    s = settings()
    tok = _json(
        httpx.post(
            "https://open.tiktokapis.com/v2/oauth/token/",
            data={
                "client_key": s.tiktok_client_key,
                "client_secret": s.tiktok_client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri("tiktok"),
                "code_verifier": verifier,
            },
        ),
        "틱톡 토큰 교환",
    )
    me = _json(
        httpx.get("https://open.tiktokapis.com/v2/user/info/?fields=open_id,username,display_name", headers={"authorization": f"Bearer {tok['access_token']}"}),
        "틱톡 계정 조회",
    )
    u = (me.get("data") or {}).get("user") or {}
    if not u.get("username"):
        raise RuntimeError("틱톡 사용자명을 받지 못했어요. (user.info.profile 권한 필요)")
    return Account(str(u["open_id"]), f"@{u['username']}", f"https://www.tiktok.com/@{u['username']}")


# ── 개발용 mock: 이 API가 띄우는 화면에서 사용자명을 입력 ──
def _mock_exchange(code: str, _: str) -> Account:
    username = re.sub(r"[^a-z0-9_.]", "", code, flags=re.I)[:30] or "tester"
    return Account(f"mock-{username}", f"@{username}", f"https://example.com/@{username}")


PROVIDERS: dict[str, Provider] = {
    "youtube": Provider("YouTube", lambda: bool(settings().google_client_id and settings().google_client_secret), _yt_url, _yt_exchange),
    "instagram": Provider("Instagram", lambda: bool(settings().instagram_client_id and settings().instagram_client_secret), _ig_url, _ig_exchange),
    "threads": Provider("Threads", lambda: bool(settings().threads_client_id and settings().threads_client_secret), _th_url, _th_exchange),
    "tiktok": Provider("TikTok", lambda: bool(settings().tiktok_client_key and settings().tiktok_client_secret), _tt_url, _tt_exchange),
    "mock": Provider(
        "테스트 계정",
        lambda: settings().enable_mock_oauth,
        lambda state, _: f"{settings().api_public_url}/oauth/mock/authorize?state={state}",
        _mock_exchange,
    ),
}
