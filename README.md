# ChainBuy

스마트 컨트랙트 에스크로 기반 공동구매 플랫폼.
참여금은 컨트랙트가 보관하고, 체인에 등록된 판매자·허용 쇼핑몰에만 돈이 나가며, 플랫폼 수수료(5%)는 수령 확인 또는 7일 뒤에 정산됩니다.

| 폴더 | 내용 | 기술 |
| --- | --- | --- |
| `blockchain/` | ChainBuy · ChainBuyUSD 컨트랙트 | Solidity 0.8.24, Hardhat, OpenZeppelin 5 |
| `frontend/` | 웹 화면 | Next.js 15, wagmi · viem, TanStack Query, Tailwind |
| `backend/server/` | API + AI 구매 에이전트 | FastAPI, SQLAlchemy, Alembic, PostgreSQL, JWT |
| `mock/` | 외부 쇼핑몰 · 일회용 카드 발급사 · 택배사 흉내 | FastAPI |
| `backend/smoke/` | API 스모크 테스트 | TypeScript |

## 결제 경로

- **경로 A (입점 판매자)**: 목표 달성 → 에이전트가 가격 확인 → 담당자 승인 → `payListed`로 판매자에게 지급(판매자 부담 5%) → 판매자가 운송장 등록
- **경로 B (외부 쇼핑몰 링크)**: 에이전트가 페이지를 읽어 조건 확인 → 담당자 승인 → `fundCard`로 일회용 카드 발급사에 한도만큼 지급 → 에이전트가 카드로 주문 → 남은 금액 `returnRemainder` 반환(참여자 부담 5%)

## 로컬 실행

필요: Node 20+, Python 3.12+, PostgreSQL, MetaMask(브라우저 확장)

터미널 5개를 열어 순서대로 실행합니다. 처음 한 번만 하는 설치는 `(처음 한 번)`으로 표시했어요.

### 1. 체인 (터미널 1)

```bash
cd blockchain
npm install                     # (처음 한 번)
npm run node                    # 로컬 체인 실행. 켜 둔 채로 둔다
```

화면에 테스트 계정 20개의 주소와 Private Key가 출력됩니다. 4단계에서 씁니다.

### 2. 컨트랙트 배포 + 데모 공구 (터미널 2)

```bash
cd blockchain
npm run deploy:local            # 컨트랙트 배포 → 프론트 주소 자동 갱신
npm run seed:local              # 데모 공구 16개 + 모든 계정에 테스트 토큰 지급
```

### 3. 서버들

DB는 둘 중 하나를 고르세요.
- PostgreSQL을 설치해 쓰는 경우: `createdb chainbuy`
- Docker를 쓰는 경우: `docker compose up -d db`. 그리고 `backend/server/.env`의 `DATABASE_URL`을 주석에 있는 값으로 바꿉니다.

```bash
# 터미널 2 — API (http://localhost:4000)
cd backend/server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # (처음 한 번)
cp .env.example .env                                                  # (처음 한 번)
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --port 4000
```

```bash
# 터미널 3 — mock 쇼핑몰·카드 발급사·택배사 (http://localhost:4100/docs)
cd mock
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # (처음 한 번)
.venv/bin/uvicorn app.main:app --port 4100
```

```bash
# 터미널 4 — AI 구매 에이전트 (10초마다 체인을 보고 다음 단계를 진행)
cd backend/server
.venv/bin/python -m app.agent
```

```bash
# 터미널 5 — 웹 (http://localhost:3000)
cd frontend
npm install                     # (처음 한 번)
npm run dev
```

http://localhost:3000/groups 에 모집 중인 공구 15개가 보이면 준비가 끝난 거예요. (시드 16개 중 1개는 배송 단계까지 진행돼 "종료된 공구 포함"을 켜야 보여요) 안 보이면 새로고침하세요.

API 문서(Swagger)는 http://localhost:4000/docs 예요. 로그인이 필요한 API는 아래 순서로 토큰을 넣고 호출합니다.
1. 웹에서 지갑으로 로그인합니다.
2. 개발자 도구 → Application → Local Storage에서 `chainbuy.session.<지갑 주소>`의 `token` 값을 복사합니다.
3. Swagger 오른쪽 위 **Authorize**에 붙여 넣습니다.

mock 서비스 문서는 http://localhost:4100/docs 예요.

### 4. MetaMask 설정 (처음 한 번)

1. 네트워크를 추가합니다: 이름 `Hardhat`, RPC `http://127.0.0.1:8545`, 체인 ID `31337`, 통화 `ETH`.
2. "계정 가져오기"로 1단계 화면에 나온 Private Key를 붙여 넣습니다. 역할별로 아래 계정을 쓰세요.

| 계정 | 역할 | 할 수 있는 것 |
| --- | --- | --- |
| #1 | 담당자 (REVIEWER) | `/admin`: 결제 승인, 판매자 입점 승인, 외부 상품 제안 승인 |
| #4 | 데모 판매자 | `/seller`: 상품 등록, 공구 열기, 운송장 등록 |
| #6 또는 새로 만든 계정 | 일반 참여자 | 공구 참여, 환불 받기, 수령 확인, 외부 상품 제안. **ETH가 없어도 돼요** (가스비는 플랫폼 대납) |

#0, #2, #3, #5, #7은 배포자, 에이전트, 수수료 지갑, 카드 발급사, 가스비 대납(번들러) 지갑이 쓰는 계정이라 테스트에는 쓰지 마세요.

**계정 추상화 (ERC-4337)**: 참여자는 MetaMask 주소가 주인인 스마트 지갑으로 참여해요. 참여·환불·수령 확인 때 MetaMask에는 "서명 요청"만 뜨고(거래 아님), 가스비는 플랫폼의 Paymaster가 냅니다. 토큰 잔액과 참여 기록은 스마트 지갑 주소에 남아요.
테스트 계정 키는 누구나 아는 공개 키라 로컬에서만 쓰고, 실제 돈을 넣으면 안 돼요.

### 5. 해 볼 만한 시나리오

**경로 A: 입점 판매자 공구**

1. 참여자 #6으로 로그인합니다.
2. "에티오피아 예가체프 원두 1kg"(17/20)에 3개 참여해 목표를 채웁니다.
3. 에이전트가 마감 처리와 가격 확인을 합니다. 10~20초 기다리세요.
4. 담당자 #1로 바꿔 `/admin` → "결제 승인"에서 승인합니다. 에이전트가 판매자에게 결제합니다.
5. 판매자 #4로 바꿔 `/seller`에서 해당 공구의 운송장을 등록합니다. 2분 뒤 mock 택배사가 배송 완료로 바꿉니다.
6. 참여자 #6으로 돌아가 공구 화면에서 수령을 확인합니다.

**경로 B: 외부 쇼핑몰 링크 공구**

1. 참여자 #6으로 로그인합니다.
2. `/create`에서 쿠팡 링크(예: `https://www.coupang.com/vp/products/123`)로 공구를 제안합니다.
3. 담당자 #1로 바꿔 `/admin` → "외부 상품 공구 제안"에서 승인합니다. 이때 체인에 공구가 만들어집니다.
4. 여러 참여자 계정으로 목표 수량을 채웁니다.
5. "결제 승인"에서 승인합니다.
6. 에이전트가 카드 충전 → 주문 → 남은 금액 반환까지 진행합니다.
7. 참여자 화면에 "환불 받기"(차액)가 생깁니다.
8. 에이전트가 하는 일은 터미널 4에서 볼 수 있어요.

**데모 조작**

`http://localhost:4100/docs`에서 직접 호출합니다. 가격 올리기와 품절은 `PATCH /shop/api/products/{id}`, 주문 취소 환불은 `POST /shop/api/orders/{id}/cancel`, 즉시 배송 완료는 `POST /courier/api/tracking/{no}/deliver`예요.

### 처음부터 다시 하기

로컬 체인은 끄면 데이터가 모두 사라집니다. 체인을 다시 켰다면 아래를 모두 해 주세요.

```bash
cd blockchain && npm run deploy:local && npm run seed:local
dropdb chainbuy && createdb chainbuy && (cd ../backend/server && .venv/bin/alembic upgrade head)   # Docker면: docker compose down -v && docker compose up -d db
rm -f ../mock/data.json
```

- API, mock, 에이전트를 다시 켜고, 웹은 새로고침합니다.
- MetaMask는 설정 → 고급 → "활동 탭 데이터 지우기"를 계정마다 눌러야 합니다. 안 하면 트랜잭션이 nonce 오류로 실패해요.

## 테스트

```bash
cd blockchain && npm test                 # 컨트랙트
cd backend/server && .venv/bin/pytest     # API 단위
cd backend/smoke && npm run smoke         # API 스모크 (API 실행 중, 빈 DB 기준 — 두 번째 실행부터는 이미 만든 데이터 때문에 일부 실패)
```

PR과 main 푸시마다 GitHub Actions가 위 테스트와 프론트 lint·build를 모두 돌립니다 (`.github/workflows/ci.yml`).
컨트랙트를 바꿨다면 `cd blockchain && npm run sync:abi`로 ABI 복사본도 갱신하세요.

## 배포

[DEPLOY.md](DEPLOY.md) — Sepolia · Render · Vercel
