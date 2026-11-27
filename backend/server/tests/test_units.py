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
    monkeypatch.setattr(reader, "settings", lambda: settings().model_copy(update={"llm_api_key": "test-key", "llm_api_format": "anthropic"}))

    result = reader.read_product(PAGE)
    assert result == {"price": 25900, "inStock": True, "options": ["1kg"], "method": "llm"}
    assert sent["max_tokens"] >= 2000 and sent["output_config"] == {"effort": "low"}


def test_llm_reader_falls_back_when_cut_off(monkeypatch):
    from app.agent import reader

    cut_off = {"stop_reason": "max_tokens", "content": [{"type": "thinking", "thinking": ""}]}
    monkeypatch.setattr(reader.httpx, "post", lambda *args, **kwargs: FakeLlmResponse(cut_off))
    monkeypatch.setattr(reader, "settings", lambda: settings().model_copy(update={"llm_api_key": "test-key", "llm_api_format": "anthropic"}))

    result = reader.read_product(PAGE)
    assert result["method"] == "rule" and result["price"] == 25900
    assert "max_tokens" in result["llmError"]


def test_llm_reader_openai_format_for_baze_gateway(monkeypatch):
    from app.agent import reader

    sent = {}

    def fake_post(url, headers, json, timeout):
        sent.update(url=url, headers=headers, body=json)
        reply = {"choices": [{"finish_reason": "stop", "message": {"content": '```json\n{"price": 25900, "inStock": true, "options": ["1kg"]}\n```'}}]}
        return FakeLlmResponse(reply)

    monkeypatch.setattr(reader.httpx, "post", fake_post)
    gateway = {"llm_api_key": "baze-key", "llm_api_format": "openai", "llm_api_url": "https://gateway.example/chat/completions/"}
    monkeypatch.setattr(reader, "settings", lambda: settings().model_copy(update=gateway))

    result = reader.read_product(PAGE)
    assert result == {"price": 25900, "inStock": True, "options": ["1kg"], "method": "llm"}
    assert sent["headers"]["Authorization"] == "Bearer baze-key"
    # BAZE는 system 메시지를 무시하므로 지시문이 user 메시지에 들어가야 한다
    only_message = sent["body"]["messages"][0]
    assert only_message["role"] == "user" and "untrusted data" in only_message["content"]


# ─────────────── 계정 추상화: 가스비 대납 정책 (체인 없이) ───────────────

CHAINBUY = "0x" + "c" * 40
TOKEN = "0x" + "d" * 40
ACCOUNT = "0x" + "a" * 40


def _account_call(calls: list[tuple[str, bytes]]) -> bytes:
    from eth_abi import encode
    from eth_utils import keccak

    selector = keccak(text="executeBatch(address[],uint256[],bytes[])")[:4]
    return selector + encode(["address[]", "uint256[]", "bytes[]"], [[c[0] for c in calls], [], [c[1] for c in calls]])


def _function_call(signature: str, types: list[str], args: list) -> bytes:
    from eth_abi import encode
    from eth_utils import keccak

    return keccak(text=signature)[:4] + encode(types, args)


@pytest.fixture
def sponsored_targets(monkeypatch):
    from eth_utils import to_checksum_address

    from app import account_abstraction

    monkeypatch.setattr(account_abstraction, "_sponsored_targets", lambda: (to_checksum_address(CHAINBUY), to_checksum_address(TOKEN)))
    return account_abstraction


def test_sponsor_policy_allows_approve_and_deposit(sponsored_targets):
    from eth_utils import to_checksum_address

    call_data = _account_call(
        [
            (TOKEN, _function_call("approve(address,uint256)", ["address", "uint256"], [CHAINBUY, 10])),
            (CHAINBUY, _function_call("deposit(uint256,uint32,bytes32)", ["uint256", "uint32", "bytes32"], [1, 1, b"\x00" * 32])),
        ]
    )
    assert sponsored_targets.check_sponsored_calls(to_checksum_address(ACCOUNT), call_data) == ["토큰 사용 승인", "참여"]


@pytest.mark.parametrize(
    "target, call",
    [
        (TOKEN, ("transfer(address,uint256)", ["address", "uint256"], ["0x" + "e" * 40, 1])),  # 남에게 토큰 보내기
        (TOKEN, ("approve(address,uint256)", ["address", "uint256"], ["0x" + "e" * 40, 1])),  # ChainBuy 아닌 곳에 승인
        (TOKEN, ("mint(address,uint256)", ["address", "uint256"], ["0x" + "e" * 40, 1])),  # 남의 지갑으로 발행
        ("0x" + "e" * 40, ("refund(uint256)", ["uint256"], [1])),  # 다른 컨트랙트
    ],
)
def test_sponsor_policy_rejects_unrelated_calls(sponsored_targets, target, call):
    from eth_utils import to_checksum_address

    call_data = _account_call([(target, _function_call(*call))])
    with pytest.raises(ApiError) as e:
        sponsored_targets.check_sponsored_calls(to_checksum_address(ACCOUNT), call_data)
    assert e.value.status == 400
