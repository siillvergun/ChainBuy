"""DB·체인 없이 돌아가는 단위 테스트 (pytest). 전체 흐름은 backend/smoke 가 HTTP로 검증한다."""

import time

import jwt
import pytest
from fastapi.security import HTTPAuthorizationCredentials
from eth_account import Account
from eth_account.messages import encode_defunct

from app.auth import current_user, login_message
from app.chain import id_hash
from app.config import settings
from app.errors import ApiError
from app.models import User
from app.routers.core import check_mall_url


def bearer(token: str) -> HTTPAuthorizationCredentials:
    """Authorization: Bearer <token> 헤더를 HTTPBearer가 꺼낸 모양으로"""
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
from app.routers.users import recipient_hash


def test_id_hash_matches_solidity_keccak():
    # 컨트랙트 테스트(fixture.ts)의 ethers.id("seller:coffee-roasters") 와 같은 값
    assert id_hash("seller:demo") == "0x305e49298b022631e6fbb7f3b4875fd14f3adc555717b331854fde757c8fbbf5"


def test_login_signature_recovers_wallet():
    acct = Account.create()
    msg = login_message(acct.address, "abc")
    sig = acct.sign_message(encode_defunct(text=msg)).signature
    assert Account.recover_message(encode_defunct(text=msg), signature=sig) == acct.address


def test_jwt_valid_expired_and_missing():
    s = settings()
    ok = jwt.encode({"sub": "0xabc", "exp": int(time.time()) + 60}, s.jwt_secret, algorithm="HS256")
    assert current_user(bearer(ok)).address == "0xabc"

    old = jwt.encode({"sub": "0xabc", "exp": int(time.time()) - 1}, s.jwt_secret, algorithm="HS256")
    with pytest.raises(ApiError) as e:
        current_user(bearer(old))
    assert e.value.status == 401 and "만료" in e.value.message

    with pytest.raises(ApiError) as e:
        current_user(None)
    assert e.value.status == 401 and "로그인해" in e.value.message


@pytest.mark.parametrize(
    "url, ok",
    [
        ("https://www.coupang.com/vp/products/1", True),
        ("https://smartstore.naver.com/shop/products/1", True),
        ("http://www.coupang.com/vp/products/1", False),  # https 아님
        ("https://evil-mall.com/item/1", False),  # 허용 목록 밖
        ("https://coupang.com.evil.com/x", False),  # 도메인 끝이 다름
    ],
)
def test_mall_url(url, ok):
    if ok:
        assert check_mall_url(url)[1] == "merchant:demo-mall"
    else:
        with pytest.raises(ApiError):
            check_mall_url(url)


def test_recipient_hash_uses_salt():
    base = dict(ship_name="홍길동", ship_phone="010-1234-5678", ship_zip="06236", ship_addr1="서울특별시 강남구 테헤란로 123", ship_addr2="4층")
    a = User(address="0x1", salt="aa", **base)
    b = User(address="0x2", salt="bb", **base)
    assert recipient_hash(a) != recipient_hash(b)  # 같은 주소라도 사람마다 다른 해시
    assert recipient_hash(a) == recipient_hash(User(address="0x1", salt="aa", **base))
    assert recipient_hash(User(address="0x3", salt="cc")) is None  # 배송지 없음


class FakeLlmResponse:
    def __init__(self, body: dict):
        self.body = body

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return self.body


PAGE = "<h1>원두 1kg</h1><p>25,900원</p><select><option>1kg</option></select>"


def test_llm_reader_requests_room_for_thinking(monkeypatch):
    from app.agent import reader

    sent = {}

    def fake_post(url, headers, json, timeout):
        sent.update(json)
        reply = {"stop_reason": "end_turn", "content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": '{"price": 25900, "inStock": true, "options": ["1kg"]}'}]}
        return FakeLlmResponse(reply)

    monkeypatch.setattr(reader.httpx, "post", fake_post)
    monkeypatch.setattr(reader, "settings", lambda: settings().model_copy(update={"llm_api_key": "test-key"}))

    result = reader.read_product(PAGE)
    assert result == {"price": 25900, "inStock": True, "options": ["1kg"], "method": "llm"}
    assert sent["max_tokens"] >= 2000 and sent["output_config"] == {"effort": "low"}


def test_llm_reader_falls_back_when_cut_off(monkeypatch):
    from app.agent import reader

    cut_off = {"stop_reason": "max_tokens", "content": [{"type": "thinking", "thinking": ""}]}
    monkeypatch.setattr(reader.httpx, "post", lambda *args, **kwargs: FakeLlmResponse(cut_off))
    monkeypatch.setattr(reader, "settings", lambda: settings().model_copy(update={"llm_api_key": "test-key"}))

    result = reader.read_product(PAGE)
    assert result["method"] == "rule" and result["price"] == 25900
    assert "max_tokens" in result["llmError"]
