"""설정: 환경 변수(.env)로 바꿀 수 있고, 없으면 로컬 개발 기본값을 쓴다. (Spring의 application.yml + @ConfigurationProperties 역할)"""

import json
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_DIR = Path(__file__).resolve().parent.parent  # backend/server
ROOT = SERVER_DIR.parent.parent  # ChainBuy/


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=SERVER_DIR / ".env", extra="ignore")

    port: int = 4000
    database_url: str = "postgresql+psycopg:///chainbuy"  # 로컬 PostgreSQL, 현재 OS 사용자로 접속
    rpc_url: str = "http://127.0.0.1:8545"
    web_origin: str = "http://localhost:3000"
    api_public_url: str = "http://localhost:4000"
    chainbuy_address: str | None = None  # 없으면 blockchain/deployments/localhost.json
    chainbuy_from_block: int | None = None  # 이벤트 조회 시작 블록 (배포 블록). 없으면 deployments 파일 또는 0

    # JWT (로그인 토큰). 배포할 때는 반드시 긴 무작위 값으로 바꾼다
    jwt_secret: str = "dev-only-secret-change-me-in-production"
    jwt_ttl_seconds: int = 12 * 60 * 60

    # 개발용 가짜 OAuth (배포 시 false)
    enable_mock_oauth: bool = True

    # AI 에이전트 (python -m app.agent)
    # AGENT 역할 지갑 키. 기본값은 hardhat 테스트 계정 #2 — 공개된 테스트 키라 로컬 전용
    agent_key: str = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
    agent_interval_seconds: int = 10
    # 무료 호스팅처럼 워커를 따로 못 띄울 때: API 서버 안에서 에이전트를 같이 돌린다
    run_agent_in_api: bool = False
    mock_url: str = "http://localhost:4100"  # mock 쇼핑몰·카드 발급사·택배사
    # LLM으로 상품 화면 읽기 (없으면 규칙 기반 추출)
    llm_api_key: str = ""
    llm_model: str = "claude-sonnet-5-5"
    llm_api_url: str = "https://api.anthropic.com/v1/messages"

    google_client_id: str = ""
    google_client_secret: str = ""
    instagram_client_id: str = ""
    instagram_client_secret: str = ""
    threads_client_id: str = ""
    threads_client_secret: str = ""
    tiktok_client_key: str = ""
    tiktok_client_secret: str = ""


@lru_cache
def settings() -> Settings:
    return Settings()


def chainbuy_address() -> str:
    s = settings()
    if s.chainbuy_address:
        return s.chainbuy_address
    dep = ROOT / "blockchain" / "deployments" / "localhost.json"
    if not dep.exists():
        raise RuntimeError("ChainBuy 주소가 없어요. blockchain에서 배포하거나 CHAINBUY_ADDRESS를 설정하세요.")
    return json.loads(dep.read_text())["ChainBuy"]


def from_block() -> int:
    """이벤트(getLogs) 조회 시작 블록. Sepolia RPC는 조회 범위 제한이 있어서 배포 블록부터 본다"""
    s = settings()
    if s.chainbuy_from_block is not None:
        return s.chainbuy_from_block
    dep = ROOT / "blockchain" / "deployments" / "localhost.json"
    return int(json.loads(dep.read_text()).get("deployBlock", 0)) if dep.exists() and not s.chainbuy_address else 0


@lru_cache
def chainbuy_abi() -> list[dict]:
    path = ROOT / "blockchain" / "artifacts" / "contracts" / "ChainBuy.sol" / "ChainBuy.json"
    if path.exists():
        return json.loads(path.read_text())["abi"]
    # blockchain 빌드 결과가 없는 배포 환경에서는 서버에 복사해 둔 ABI를 쓴다
    return json.loads((SERVER_DIR / "app" / "abi" / "ChainBuy.json").read_text())["abi"]


CATALOG_PATH = ROOT / "frontend" / "src" / "lib" / "catalog.json"

# 허용 쇼핑몰: 도메인 → 컨트랙트 merchantId (데모에서는 모두 demo-mall 한 곳)
ALLOWED_MALLS = {
    "coupang.com": "merchant:demo-mall",
    "smartstore.naver.com": "merchant:demo-mall",
    "11st.co.kr": "merchant:demo-mall",
}

CATEGORIES = ["디지털", "가전", "식품", "음료", "캠핑", "생활", "주방", "육아", "뷰티", "반려동물", "스포츠", "패션", "건강", "문구"]
