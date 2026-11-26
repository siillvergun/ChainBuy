from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

MOCK_DIR = Path(__file__).resolve().parent.parent
ROOT = MOCK_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=MOCK_DIR / ".env", extra="ignore")

    port: int = 4100
    public_url: str = "http://localhost:4100"
    rpc_url: str = "http://127.0.0.1:8545"
    chainbuy_address: str | None = None
    token_address: str | None = None
    # 카드 발급사 지갑 (컨트랙트에 허용 쇼핑몰의 카드 충전 주소로 등록된 지갑).
    # 기본값은 hardhat 테스트 계정 #5 — 공개된 테스트 키라 로컬에서만 쓴다.
    card_issuer_key: str = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"
    merchant_id: str = "merchant:demo-mall"
    card_ttl_hours: int = 24
    # 택배: 운송장 생성 후 이 시간이 지나면 자동으로 배송 완료 (데모용)
    delivery_seconds: int = 120


@lru_cache
def settings() -> Settings:
    return Settings()
