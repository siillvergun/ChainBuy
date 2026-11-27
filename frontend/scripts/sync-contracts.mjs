// blockchain/ 의 컴파일 결과(ABI)와 로컬 배포 주소를 frontend로 가져온다.
// 사용: (blockchain에서 compile 후) npm run sync:contracts
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const chain = path.join(here, "..", "..", "blockchain");
const read = (p) => JSON.parse(fs.readFileSync(path.join(chain, p), "utf8"));

const chainBuy = read("artifacts/contracts/ChainBuy.sol/ChainBuy.json").abi;
const token = read("artifacts/contracts/ChainBuyUSD.sol/ChainBuyUSD.json").abi;
// 계정 추상화: 스마트 지갑 호출(execute/executeBatch) 만들기 · 지갑 주소 계산
const aa = "artifacts/@account-abstraction/contracts/samples";
const simpleAccount = read(`${aa}/SimpleAccount.sol/SimpleAccount.json`).abi;
const simpleAccountFactory = read(`${aa}/SimpleAccountFactory.sol/SimpleAccountFactory.json`).abi;

let local = null;
const dep = path.join(chain, "deployments", "localhost.json");
if (fs.existsSync(dep)) local = JSON.parse(fs.readFileSync(dep, "utf8"));

const out = `// 자동 생성 파일 — scripts/sync-contracts.mjs 로 다시 만든다. 직접 수정하지 말 것.
export const chainBuyAbi = ${JSON.stringify(chainBuy, null, 2)} as const;

export const chainBuyUsdAbi = ${JSON.stringify(token, null, 2)} as const;

export const simpleAccountAbi = ${JSON.stringify(simpleAccount, null, 2)} as const;

export const simpleAccountFactoryAbi = ${JSON.stringify(simpleAccountFactory, null, 2)} as const;

export const localDeployment = ${JSON.stringify(local, null, 2)} as {
  chainId: number;
  ChainBuy: \`0x\${string}\`;
  ChainBuyUSD: \`0x\${string}\`;
  feeBps: number;
  accountAbstraction?: {
    entryPoint: \`0x\${string}\`;
    accountFactory: \`0x\${string}\`;
    paymaster: \`0x\${string}\`;
    sponsor: \`0x\${string}\`;
  };
} | null;
`;
fs.writeFileSync(path.join(here, "..", "src", "lib", "contracts.generated.ts"), out);
console.log("synced ABI", local ? `+ localhost deployment (${local.ChainBuy})` : "(no localhost deployment yet)");
