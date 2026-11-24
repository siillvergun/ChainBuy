import { createPublicClient, http, keccak256, toBytes } from "viem";
import { hardhat } from "viem/chains";
import { RPC_URL, chainBuyAbi, deployment } from "./config.js";

export const client = createPublicClient({ chain: hardhat, transport: http(RPC_URL) });

export const idHash = (id: string) => keccak256(toBytes(id));

function cb() {
  if (!deployment.chainBuy) throw new Error("ChainBuy 주소가 없어요. blockchain에서 배포하세요.");
  return { address: deployment.chainBuy, abi: chainBuyAbi } as const;
}

const REVIEWER_ROLE = keccak256(toBytes("REVIEWER_ROLE"));

/** 담당자(관리자) 여부는 서버가 따로 관리하지 않고 컨트랙트의 REVIEWER 역할을 그대로 따른다 */
export async function isReviewer(address: string): Promise<boolean> {
  return (await client.readContract({ ...cb(), functionName: "hasRole", args: [REVIEWER_ROLE, address] })) as boolean;
}

export async function onchainSeller(sellerId: string) {
  const [wallet, active] = (await client.readContract({ ...cb(), functionName: "sellers", args: [idHash(sellerId)] })) as [
    `0x${string}`,
    boolean,
  ];
  return { wallet, active };
}

export async function onchainGroup(id: bigint) {
  return (await client.readContract({ ...cb(), functionName: "getGroup", args: [id] })) as {
    kind: number;
    creator: `0x${string}`;
    partyId: `0x${string}`;
    productHash: `0x${string}`;
    maxPrice: bigint;
    targetQty: number;
  };
}
