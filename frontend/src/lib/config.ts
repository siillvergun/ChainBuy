import { http, createConfig } from "wagmi";
import { hardhat, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { localDeployment } from "./contracts.generated";

/** 배포 주소: 환경 변수가 있으면 그것을, 없으면 로컬 배포 결과를 쓴다. */
export const CHAINBUY_ADDRESS = (process.env.NEXT_PUBLIC_CHAINBUY_ADDRESS ?? localDeployment?.ChainBuy) as
  | `0x${string}`
  | undefined;
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? localDeployment?.MockUSDC) as
  | `0x${string}`
  | undefined;

/** 토큰 소수점 6자리. 화면에서는 1토큰 = 1원(원화 스테이블코인 mock)으로 표시한다. */
export const TOKEN_DECIMALS = 6;

const useSepolia = process.env.NEXT_PUBLIC_CHAIN === "sepolia";
export const activeChain = useSepolia ? sepolia : hardhat;

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected()],
  transports: {
    [hardhat.id]: http("http://127.0.0.1:8545"),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC),
  } as never,
  ssr: true,
});
