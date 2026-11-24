// 스모크 테스트가 쓰는 컨트랙트 주소·ABI·RPC (백엔드 구현과 무관하게 HTTP로만 API를 검증한다)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createPublicClient, http } from "viem";
import { hardhat } from "viem/chains";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dep = JSON.parse(fs.readFileSync(path.join(root, "blockchain", "deployments", "localhost.json"), "utf8"));
export const deployment = { chainBuy: dep.ChainBuy as `0x${string}` };
export const chainBuyAbi = JSON.parse(
  fs.readFileSync(path.join(root, "blockchain", "artifacts", "contracts", "ChainBuy.sol", "ChainBuy.json"), "utf8")
).abi;
export const client = createPublicClient({ chain: hardhat, transport: http(process.env.RPC_URL ?? "http://127.0.0.1:8545") });
