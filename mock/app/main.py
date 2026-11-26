"""mock 외부 서비스 (실서비스에서는 실제 쇼핑몰·카드 발급사·택배사)

실행: uvicorn app.main:app --port 4100
"""

from fastapi import FastAPI

from . import card_issuer, courier, shop

app = FastAPI(title="ChainBuy mock 외부 서비스", description="쇼핑몰 · 일회용 가상카드 발급사 · 택배사")
app.include_router(shop.router)
app.include_router(card_issuer.router)
app.include_router(courier.router)


@app.get("/health")
def health():
    return {"ok": True}
