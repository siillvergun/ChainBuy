"""ChainBuy API (FastAPI)

돈과 규칙은 컨트랙트가 맡고, 서버는 체인 밖 정보(상품·판매자·제안·프로필·인플루언서·찜)만 다룬다.
실행: uvicorn app.main:app --port 4000
"""

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from .auth import now_ms
from .config import CATALOG_PATH, settings
from .db import SessionLocal
from .errors import install as install_errors
from .models import Product, Seller
from .routers import core, influencers, seller_orders, users

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
    yield


app = FastAPI(title="ChainBuy API", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[settings().web_origin], allow_methods=["*"], allow_headers=["*"])
install_errors(app)
app.include_router(core.router)
app.include_router(influencers.router)
app.include_router(users.router)
app.include_router(seller_orders.router)
