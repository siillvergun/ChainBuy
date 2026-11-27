"""ChainBuy API (FastAPI)

돈과 규칙은 컨트랙트가 맡고, 서버는 체인 밖 정보(상품·판매자·제안·프로필·인플루언서·찜)만 다룬다.
실행: uvicorn app.main:app --port 4000
"""

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from sqlalchemy import select

from .auth import now_ms
from .config import CATALOG_PATH, settings
from .db import SessionLocal
from .errors import install as install_errors
from .models import Product, Seller
from .routers import core, influencers, seller_orders, users, aa

# 데모 판매자 지갑 = hardhat 계정 #4 (blockchain/scripts/deploy.ts 와 같다)
DEMO_SELLER_WALLET = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"


def seed_catalog() -> None:
    """데모 상품(catalog.json)을 처음 한 번 넣는다. 로컬 시드 공구가 이 상품들을 가리킨다."""
    if not CATALOG_PATH.exists():
        return
    catalog = json.loads(CATALOG_PATH.read_text())
    now = now_ms()
    with SessionLocal() as db:
        for s in catalog["sellers"]:
            if not db.get(Seller, s["id"]) and not db.scalar(select(Seller).where(Seller.address == DEMO_SELLER_WALLET)):
                db.add(Seller(id=s["id"], address=DEMO_SELLER_WALLET, name=s["name"], biz_no="000-00-00000", contact="demo@chainbuy.local", status="approved", created_at=now))
        for p in catalog["products"]:
            if not db.get(Product, p["id"]):
                db.add(
                    Product(
                        id=p["id"], kind="listed", seller_id=p["seller"], name=p["name"], category=p["category"], option=p["option"],
                        original_price=p["originalPrice"], price=p["price"], description="", tint=p["tint"], created_at=now,
                    )
                )
        db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    seed_catalog()
    if settings().run_agent_in_api:
        import threading

        from .agent.__main__ import main as agent_main

        threading.Thread(target=agent_main, name="agent", daemon=True).start()
    yield


API_DESCRIPTION = """
스마트 컨트랙트 에스크로 공동구매 ChainBuy의 API.

**로그인이 필요한 API 쓰는 법**
1. 웹(http://localhost:3000)에서 지갑으로 로그인
2. 브라우저 개발자 도구 → Application → Local Storage → `chainbuy.session.<지갑 주소>`의 `token` 값 복사
3. 오른쪽 위 **Authorize**에 붙여 넣기 (`Bearer`는 빼고 토큰만)
"""

# Swagger에서 API를 묶어 보여 줄 영역. 주소가 이 접두어로 시작하면 해당 태그를 붙인다 (위에서부터 먼저 맞는 것)
TAGS_BY_PATH_PREFIX = [
    ("/auth", "인증"),
    ("/admin", "담당자"),
    ("/seller/", "판매자 주문"),
    ("/sellers", "판매자"),
    ("/products", "상품"),
    ("/proposals", "외부 상품 제안"),
    ("/influencers", "인플루언서"),
    ("/tags", "인플루언서"),
    ("/groups/{group_id}/tags", "인플루언서"),
    ("/oauth", "SNS 연결"),
    ("/users", "사용자"),
    ("/likes", "찜"),
    ("/groups", "공구"),
    ("/health", "상태"),
    ("/aa", "스마트 지갑 (계정 추상화)"),
]


def tag_routes_by_path(app: FastAPI) -> None:
    for route in app.routes:
        if not isinstance(route, APIRoute) or route.tags:
            continue
        for prefix, tag in TAGS_BY_PATH_PREFIX:
            if route.path.startswith(prefix):
                route.tags = [tag]
                break


app = FastAPI(title="ChainBuy API", version="0.2.0", description=API_DESCRIPTION, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[settings().web_origin], allow_methods=["*"], allow_headers=["*"])
install_errors(app)
app.include_router(core.router)
app.include_router(influencers.router)
app.include_router(users.router)
app.include_router(seller_orders.router)
app.include_router(aa.router)
tag_routes_by_path(app)
