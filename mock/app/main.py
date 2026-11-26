"""mock 외부 서비스 (실서비스에서는 실제 쇼핑몰·카드 발급사·택배사)

실행: uvicorn app.main:app --port 4100
"""

import threading
import time
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import card_issuer, courier, shop

SWEEP_SECONDS = 60


def _sweep_loop() -> None:
    """만료 카드 자동 폐기 (카드 발급사가 잔액을 돌려주지 않고 버티는 일이 없게)"""
    while True:
        try:
            card_issuer.sweep_expired()
        except Exception:
            traceback.print_exc()
        time.sleep(SWEEP_SECONDS)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(target=_sweep_loop, daemon=True, name="card-sweep").start()
    yield


app = FastAPI(title="ChainBuy mock 외부 서비스", description="쇼핑몰 · 일회용 가상카드 발급사 · 택배사", lifespan=lifespan)
app.include_router(shop.router)
app.include_router(card_issuer.router)
app.include_router(courier.router)


@app.get("/health")
def health():
    return {"ok": True}
