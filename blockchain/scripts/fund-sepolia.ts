import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Sepolia 배포 확인 + 운영 지갑에 가스비용 ETH 나눠 주기 (배포 지갑에서 보냄)
 * 사용: npx hardhat run scripts/fund-sepolia.ts --network sepolia
 */
const AMOUNTS: Record<string, string> = {
  agent: "0.008",
  sponsor: "0.008",
  cardIssuer: "0.004",
  reviewer: "0.003",
  sellerManager: "0.003",
};

async function main() {
  if (network.name !== "sepolia") throw new Error("sepolia 전용");
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "sepolia.json"), "utf8"));
  const [deployer] = await ethers.getSigners();
  const cb = await ethers.getContractAt("ChainBuy", dep.ChainBuy);
  const paymaster = await ethers.getContractAt("ChainBuyPaymaster", dep.accountAbstraction.paymaster);

  console.log("역할 확인");
  console.log("  공구 담당자", await cb.hasRole(await cb.REVIEWER_ROLE(), dep.roles.reviewer));
  console.log("  입점 담당자", await cb.hasRole(await cb.SELLER_MANAGER_ROLE(), dep.roles.sellerManager));
  console.log("  에이전트   ", await cb.hasRole(await cb.AGENT_ROLE(), dep.roles.agent));
  console.log("  Paymaster 예치금", ethers.formatEther(await paymaster.getDeposit()), "ETH");

  const targets: Record<string, string> = {
    agent: dep.roles.agent,
    sponsor: dep.accountAbstraction.sponsor,
    cardIssuer: dep.merchant.cardIssuer,
    reviewer: dep.roles.reviewer,
    sellerManager: dep.roles.sellerManager,
  };
  for (const [name, address] of Object.entries(targets)) {
    const balance = await ethers.provider.getBalance(address);
    const want = ethers.parseEther(AMOUNTS[name]);
    if (balance >= want) {
      console.log(`${name} 이미 ${ethers.formatEther(balance)} ETH`);
      continue;
    }
    await (await deployer.sendTransaction({ to: address, value: want - balance })).wait();
    console.log(`${name} ← ${ethers.formatEther(want - balance)} ETH`);
  }
  console.log("배포 지갑 남은 잔액", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
