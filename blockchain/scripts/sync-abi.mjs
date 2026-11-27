// 컨트랙트 ABI를 backend·mock·frontend로 복사한다. 컨트랙트를 바꾼 뒤: npm run compile && npm run sync:abi
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const artifact = path.join(root, "blockchain", "artifacts", "contracts", "ChainBuy.sol", "ChainBuy.json");
const { abi } = JSON.parse(fs.readFileSync(artifact, "utf8"));
const content = JSON.stringify({ abi }, null, 1) + "\n";

for (const target of ["backend/server/app/abi/ChainBuy.json", "mock/app/abi/ChainBuy.json"]) {
  fs.writeFileSync(path.join(root, target), content);
  console.log("synced", target);
}

// 백엔드 번들러·가스 대납 서명에 쓰는 계정 추상화 ABI
const aaArtifacts = {
  "EntryPoint.json": "artifacts/@account-abstraction/contracts/core/EntryPoint.sol/EntryPoint.json",
  "SimpleAccountFactory.json": "artifacts/@account-abstraction/contracts/samples/SimpleAccountFactory.sol/SimpleAccountFactory.json",
  "ChainBuyPaymaster.json": "artifacts/contracts/aa/ChainBuyPaymaster.sol/ChainBuyPaymaster.json",
};
for (const [file, artifactPath] of Object.entries(aaArtifacts)) {
  const aaAbi = JSON.parse(fs.readFileSync(path.join(root, "blockchain", artifactPath), "utf8")).abi;
  const target = `backend/server/app/abi/${file}`;
  fs.writeFileSync(path.join(root, target), JSON.stringify({ abi: aaAbi }, null, 1) + "\n");
  console.log("synced", target);
}

execFileSync("node", [path.join(root, "frontend", "scripts", "sync-contracts.mjs")], { stdio: "inherit" });
