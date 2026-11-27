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

/**
 * 체인 조회 요청 줄이기 (RPC 무료 한도 보호)
 * - batch.multicall: 같은 순간에 일어난 컨트랙트 읽기 여러 개를 Multicall3 호출 하나로 합친다 (Sepolia에 배포돼 있음)
 * - http batch: 그래도 남는 요청들을 HTTP 요청 하나에 담아 보낸다 (로컬 hardhat에도 적용)
 */
export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected()],
  batch: { multicall: true },
  transports: {
    [hardhat.id]: http("http://127.0.0.1:8545", { batch: true }),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC, { batch: true }),
  } as never,
  ssr: true,
});

/** 체인·API를 다시 읽는 간격. Sepolia 블록이 약 12초마다 생기므로 그보다 자주 읽을 필요가 없다 */
export const REFETCH_INTERVAL_MS = 15_000;
