# ChainBuy 배포 (Sepolia 테스트넷)

| 구성 | 어디에 | 비고 |
| --- | --- | --- |
| 컨트랙트 (ChainBuy, ChainBuyUSD) | Sepolia | Hardhat로 배포 |
| 프론트엔드 (Next.js) | Vercel | `frontend/` |
| API + AI 에이전트 (FastAPI) | Render (Docker) | `backend/server/`, 무료 플랜은 에이전트를 API 안에서 실행 |
| mock 쇼핑몰·카드 발급사·택배사 | Render (Docker) | `mock/` |
| PostgreSQL | Render (또는 Neon·Supabase) | |

## 0. 준비할 것 (직접)

- **Sepolia RPC 키**: Alchemy 또는 Infura
- **테스트넷 지갑 6개** (모두 Sepolia 테스트 ETH 필요, 실제 자산이 든 지갑은 쓰지 않기)
  - 배포·관리자, 공구 담당자(REVIEWER), 입점 담당자(SELLER_MANAGER), 에이전트(AGENT), 카드 발급사, 가스비 대납(SPONSOR)
  - 공구 담당자 · 입점 담당자 · 에이전트는 **반드시 서로 다른 지갑** (컨트랙트가 겸직을 막아 배포가 실패해요)
  - 참여자 지갑에는 ETH가 필요 없어요 (계정 추상화로 플랫폼이 가스비 대납)
  - 배포 지갑은 공구 담당자와 같은 지갑이어도 됩니다
- **Vercel 계정**, **Render 계정**
- (선택) LLM API 키, 각 SNS OAuth 앱 키 (`backend/server/OAUTH.md`)

## 1. 컨트랙트

```bash
cd blockchain && cp .env.example .env   # SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, 역할 주소 입력
npm run deploy:sepolia                  # → deployments/sepolia.json (주소·deployBlock)
```

배포 스크립트가 REVIEWER·AGENT 역할과 허용 쇼핑몰(`merchant:demo-mall` → 카드 발급사 지갑)을 등록합니다.

계정 추상화(ERC-4337)도 같이 배포돼요: Sepolia의 표준 EntryPoint(`0x0000000071727De22E5E9d8BAf0edAc6f37da032`)를 쓰고, 스마트 지갑 팩토리와 `ChainBuyPaymaster`를 배포한 뒤 Paymaster에 가스비용 Sepolia ETH(`PAYMASTER_DEPOSIT_ETH`, 기본 0.05)를 맡겨 둡니다. `blockchain/.env`에 `SPONSOR_ADDRESS`(백엔드 `SPONSOR_KEY`의 주소)를 넣고 배포하세요. 예치금이 떨어지면 참여가 실패하니, 시연 전에 `paymaster.getDeposit()`을 확인하고 필요하면 `paymaster.deposit()`으로 더 넣어 주세요.

## 2. API · mock (Render)

1. Render에서 이 저장소로 **Blueprint** 만들기 → `render.yaml`이 DB·API·mock을 만듭니다.
2. `sync: false` 값을 채웁니다:
   - API: `RPC_URL`, `CHAINBUY_ADDRESS`, `CHAINBUY_FROM_BLOCK`(deployBlock), `AGENT_KEY`, `WEB_ORIGIN`, `API_PUBLIC_URL`, `MOCK_URL`, `LLM_API_KEY`, `SPONSOR_KEY`, `ENTRY_POINT_ADDRESS`, `ACCOUNT_FACTORY_ADDRESS`, `PAYMASTER_ADDRESS` (`deployments/sepolia.json`의 `accountAbstraction`)
   - mock: `RPC_URL`, `CHAINBUY_ADDRESS`, `TOKEN_ADDRESS`, `CARD_ISSUER_KEY`, `PUBLIC_URL`
3. API는 시작할 때 `alembic upgrade head`로 테이블을 만듭니다.

무료 플랜은 한동안 요청이 없으면 잠들어서 에이전트도 같이 멈춥니다. 발표 전에 API 주소를 한 번 열어 깨워 두세요.

## 3. 프론트 (Vercel)

Root Directory `frontend`, 환경 변수:

| 이름 | 값 |
| --- | --- |
| `NEXT_PUBLIC_CHAIN` | `sepolia` |
| `NEXT_PUBLIC_SEPOLIA_RPC` | Sepolia RPC 주소 |
| `NEXT_PUBLIC_CHAINBUY_ADDRESS` | ChainBuy 주소 |
| `NEXT_PUBLIC_TOKEN_ADDRESS` | ChainBuyUSD 주소 |
| `NEXT_PUBLIC_API_URL` | Render API 주소 |

## 4. 데모 준비

- 판매자: 사이트에서 입점 신청 → 담당자 지갑으로 `/admin`에서 승인(setSeller) → 상품 등록 → 공구 열기
- 참여자: 상세 화면의 "테스트 토큰 받기"로 ChainBuyUSD 발급 → 배송지 등록 → 참여
- 목표가 차면 에이전트가 상품 확인 → 담당자가 `/admin` 결제 승인 → 에이전트가 결제·주문·배송·수수료 처리
- 택배는 mock이 `DELIVERY_SECONDS`(기본 120초) 뒤 자동 배송 완료. 바로 보려면 `POST {mock}/courier/api/tracking/{번호}/deliver`
