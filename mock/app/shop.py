"""mock 쇼핑몰 (허용 쇼핑몰 = demo-mall)

- 허용 쇼핑몰 링크(쿠팡·스마트스토어·11번가)를 이 mock 상품으로 매핑한다 (실제 쇼핑몰은 자동화 접근이 막혀 있어서)
- AI 에이전트가 읽는 상품 화면(HTML)과 JSON을 준다
- 데모용으로 가격·재고를 바꿀 수 있다 (가격 상승·품절 시나리오)
- 주문은 카드로만 받고, 카드 발급사에 결제 승인을 요청한다
"""

import html
import secrets
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from . import card_issuer, store
from .config import settings

router = APIRouter(prefix="/shop", tags=["쇼핑몰"])


def _key(url: str) -> str:
    return url.split("?")[0].rstrip("/")


class LookupIn(BaseModel):
    url: str
    name: str = ""
    option: str = ""
    price: int = Field(default=0, ge=0)  # 처음 보는 링크면 이 값으로 상품을 만든다 (제안 시 입력한 현재가)


@router.post("/api/lookup")
def lookup(body: LookupIn):
    """허용 쇼핑몰 링크 → mock 상품 (없으면 만든다)"""
    products = store.table("products")
    key = _key(body.url)
    p = next((x for x in products.values() if x["url"] == key), None)
    if not p:
        pid = f"p_{secrets.token_hex(4)}"
        p = {"id": pid, "url": key, "name": body.name or "상품", "options": [body.option] if body.option else ["기본"], "price": body.price or 10000, "stock": 100}
        products[pid] = p
        store.save()
    return p


@router.get("/api/products/{pid}")
def product(pid: str):
    p = store.table("products").get(pid)
    if not p:
        raise HTTPException(404, "상품이 없어요")
    return p


class PatchIn(BaseModel):
    price: int | None = Field(default=None, gt=0)
    stock: int | None = Field(default=None, ge=0)


@router.patch("/api/products/{pid}")
def patch_product(pid: str, body: PatchIn):
    """데모 조작: 가격 상승·품절 만들기"""
    p = product(pid)
    if body.price is not None:
        p["price"] = body.price
    if body.stock is not None:
        p["stock"] = body.stock
    store.save()
    return p


@router.get("/products/{pid}", response_class=HTMLResponse)
def product_page(pid: str):
    """AI 에이전트가 읽는 상품 화면 (일반 쇼핑몰 페이지 흉내)"""
    p = product(pid)
    stock = "품절" if p["stock"] <= 0 else f"재고 {p['stock']}개"
    opts = "".join(f"<option>{html.escape(o)}</option>" for o in p["options"])
    return f"""<!doctype html><meta charset="utf-8"><title>{html.escape(p['name'])}</title>
<body style="font-family:sans-serif;max-width:640px;margin:40px auto">
<p style="color:#999">DEMO MALL</p><h1>{html.escape(p['name'])}</h1>
<p class="price" style="font-size:28px;font-weight:700">{p['price']:,}원</p>
<p class="stock">{stock}</p><label>옵션 <select>{opts}</select></label></body>"""


class CardIn(BaseModel):
    number: str
    cvc: str
    exp: str


class OrderIn(BaseModel):
    productId: str
    option: str = ""
    qty: int = Field(gt=0)
    card: CardIn
    shippingNote: str = ""  # 받는 곳 (데모에서는 공구 단위 일괄 배송으로 처리)


@router.post("/api/orders", status_code=201)
def order(body: OrderIn):
    p = product(body.productId)
    if p["stock"] < body.qty:
        raise HTTPException(409, "재고가 부족해요")
    amount = p["price"] * body.qty
    approval = card_issuer.authorize(body.card.number, body.card.cvc, body.card.exp, amount, settings().merchant_id)
    p["stock"] -= body.qty
    oid = f"ORD-{int(time.time())}-{secrets.token_hex(3).upper()}"
    store.table("orders")[oid] = {
        "orderId": oid,
        "productId": p["id"],
        "qty": body.qty,
        "amount": amount,
        "approvalId": approval["approvalId"],
        "cardId": approval["cardId"],
        "status": "ordered",  # ordered | cancelled
        "createdAt": int(time.time() * 1000),
    }
    store.save()
    return store.table("orders")[oid]


@router.post("/api/orders/{oid}/cancel")
def cancel_order(oid: str):
    """데모 조작: 주문 취소 → 결제 금액을 카드로 환불 → 카드 발급사가 컨트랙트로 돌려준다 (PB-06)"""
    o = store.table("orders").get(oid)
    if not o:
        raise HTTPException(404, "주문이 없어요")
    if o.get("status") == "cancelled":
        raise HTTPException(409, "이미 취소된 주문이에요")
    card_issuer.refund_to_card(o["cardId"], o["amount"])
    o["status"] = "cancelled"
    product(o["productId"])["stock"] += o["qty"]
    store.save()
    return o
