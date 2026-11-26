# ChainBuy · mock 외부 서비스

실서비스에서는 실제 쇼핑몰·카드 발급사·택배사가 맡을 부분을 흉내 냅니다. (FastAPI, 포트 4100)

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 4100 --reload
```

API 문서: http://localhost:4100/docs

| 서비스 | 주요 API | 설명 |
| --- | --- | --- |
| 쇼핑몰 | `POST /shop/api/lookup` | 허용 쇼핑몰 링크 → mock 상품 (없으면 생성) |
| | `GET /shop/products/{id}` | AI가 읽는 상품 화면 |
| | `PATCH /shop/api/products/{id}` | 데모: 가격 상승·품절 |
| | `POST /shop/api/orders` | 카드 결제 주문 |
| | `POST /shop/api/orders/{id}/cancel` | 데모 조작: 주문 취소 → 카드 환불 → 컨트랙트 `returnRefund` (PB-06) |
| 카드 발급사 | `POST /card/api/cards` | 공구별 일회용 카드 (한도 = 체인 충전액) |
| | `POST /card/api/cards/{id}/close` | 폐기 + 잔액을 컨트랙트 `returnRemainder`로 반환 (유효 기간이 지나면 60초마다 자동 폐기) |
| 택배사 | `POST /courier/api/shipments` | 운송장 생성 |
| | `GET /courier/api/tracking/{no}` | 조회 (생성 후 `DELIVERY_SECONDS` 지나면 배송 완료) |
| | `POST /courier/api/tracking/{no}/deliver` | 데모: 바로 배송 완료 |

카드 발급사 지갑 키(`CARD_ISSUER_KEY`)는 기본값이 hardhat 테스트 계정 #5라 로컬 전용입니다. Sepolia에서는 `.env`로 바꾸고, 그 지갑 주소를 컨트랙트 `setMerchant`의 카드 충전 주소로 등록해야 합니다.
