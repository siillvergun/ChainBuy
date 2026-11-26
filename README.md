# ChainBuy

스마트 컨트랙트 에스크로 기반 공동구매 플랫폼.
참여금은 컨트랙트가 보관하고, 체인에 등록된 판매자·허용 쇼핑몰에만 돈이 나가며, 플랫폼 수수료(5%)는 수령 확인 또는 7일 뒤에 정산됩니다.

| 폴더 | 내용 | 기술 |
| --- | --- | --- |
| `blockchain/` | ChainBuy · MockUSDC 컨트랙트 | Solidity 0.8.24, Hardhat, OpenZeppelin 5 |
| `frontend/` | 웹 화면 | Next.js 15, wagmi · viem, TanStack Query, Tailwind |
| `backend/server/` | API + AI 구매 에이전트 | FastAPI, SQLAlchemy, Alembic, PostgreSQL, JWT |
| `mock/` | 외부 쇼핑몰 · 일회용 카드 발급사 · 택배사 흉내 | FastAPI |
| `backend/smoke/` | API 스모크 테스트 | TypeScript |

## 결제 경로

- **경로 A (입점 판매자)**: 목표 달성 → 에이전트가 가격 확인 → 담당자 승인 → `payListed`로 판매자에게 지급(판매자 부담 5%) → 판매자가 운송장 등록
- **경로 B (외부 쇼핑몰 링크)**: 에이전트가 페이지를 읽어 조건 확인 → 담당자 승인 → `fundCard`로 일회용 카드 발급사에 한도만큼 지급 → 에이전트가 카드로 주문 → 남은 금액 `returnRemainder` 반환(참여자 부담 5%)

## 로컬 실행

필요: Node 20+, Python 3.12+, PostgreSQL(또는 `docker compose up -d`)

```bash
# 1) 체인
cd blockchain && npm install && npm run node            # 터미널 1
npm run deploy:local && npm run seed:local               # 터미널 2

# 2) API
cd backend/server && python -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env && createdb chainbuy
.venv/bin/alembic upgrade head && .venv/bin/uvicorn app.main:app --port 4000

# 3) mock 서비스 (경로 B · 택배)
cd mock && python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 4100

# 4) AI 에이전트
cd backend/server && .venv/bin/python -m app.agent

# 5) 웹
cd frontend && npm install && npm run dev                # http://localhost:3000
```

MetaMask에 Hardhat 네트워크(`http://127.0.0.1:8545`, chainId 31337)를 추가하고 Hardhat 테스트 계정을 가져와 쓰세요.
#1이 담당자(REVIEWER), #4가 데모 판매자입니다.

## 테스트

```bash
cd blockchain && npm test                 # 컨트랙트
cd backend/server && .venv/bin/pytest     # API 단위
cd backend/smoke && npm run smoke         # API 스모크 (API 실행 중)
```

## 배포

[DEPLOY.md](DEPLOY.md) — Sepolia · Render · Vercel
