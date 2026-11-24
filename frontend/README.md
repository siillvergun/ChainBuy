# ChainBuy · frontend

Next.js(App Router) + wagmi + Tailwind로 만든 웹 화면입니다. 공구 정보는 컨트랙트에서 직접 읽고, 상품 이름·이미지는 백엔드가 생기기 전까지 `src/lib/catalog.json`(mock)을 씁니다.

## 로컬에서 실행

터미널 3개를 씁니다.

```bash
cd blockchain && npm run node                         # 1. 로컬 블록체인
```

```bash
cd blockchain && npm run deploy:local && npm run seed:local && cd ../frontend && npm run sync:contracts   # 2. 배포 + 데모 공구 8개 + ABI 동기화
```

```bash
cd frontend && npm run dev                            # 3. http://localhost:3000
```

### MetaMask 연결

1. MetaMask에 네트워크 추가: RPC `http://127.0.0.1:8545`, 체인 ID `31337`
2. `npx hardhat node` 출력에 나오는 테스트 계정 개인키 중 하나를 가져오기 (테스트 전용 계정만)
3. 상세 화면에서 토큰이 부족하면 **테스트 토큰 받기** 버튼으로 받을 수 있어요

로컬 체인을 재시작하면 MetaMask 계정의 nonce가 꼬일 수 있어요. 그때는 MetaMask 설정 → 고급 → 활동 탭 데이터 지우기를 누르세요.

## 화면

| 경로 | 내용 |
| --- | --- |
| `/` | 배너, 카테고리, 실시간 인기 공구, 오늘 마감, 판매자 특가 |
| `/groups` | 전체 목록 (카테고리·유형·정렬·검색·종료 포함) |
| `/groups/[id]` | 상세, 고정 조건, 진행 과정, 참여·취소·환불·수령 확인·이의 |
| `/create` | 판매자 특가 상품으로 공구 열기, 외부 상품 제안(백엔드 연동 전 비활성) |
| `/my` | 내 참여, 예치 중 금액, 환불 가능 금액 |
| `/login` | 로그인·회원가입 화면 (계정 기능은 백엔드 단계에서 연결) |

## 환경 변수 (Sepolia 배포 시)

| 이름 | 설명 |
| --- | --- |
| `NEXT_PUBLIC_CHAIN` | `sepolia` 로 두면 Sepolia 사용 |
| `NEXT_PUBLIC_SEPOLIA_RPC` | Sepolia RPC 주소 |
| `NEXT_PUBLIC_CHAINBUY_ADDRESS` | ChainBuy 컨트랙트 주소 |
| `NEXT_PUBLIC_USDC_ADDRESS` | MockUSDC 주소 |
