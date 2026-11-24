import { ethers, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import fs from "fs";
import path from "path";

/**
 * 로컬 데모 데이터: frontend/src/lib/catalog.json 의 상품으로 공구를 만들고 참여자를 채운다.
 * 사용: npm run node → npm run deploy:local → npm run seed:local
 */
async function main() {
  if (network.name !== "localhost" && network.name !== "hardhat") throw new Error("로컬 네트워크 전용");

  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`), "utf8"));
  const catalog = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "lib", "catalog.json"), "utf8")
  );
  const signers = await ethers.getSigners();
  const [, , agent, , seller] = signers;
  const buyers = signers.slice(8, 20);
  const reviewer = signers[1];

  const usdc = await ethers.getContractAt("MockUSDC", dep.MockUSDC);
  const cb = await ethers.getContractAt("ChainBuy", dep.ChainBuy);
  const won = (n: number) => ethers.parseUnits(String(n), 6);

  // 모든 로컬 계정에 테스트 토큰 지급 (MetaMask로 hardhat 계정을 가져와 쓰는 경우 대비)
  for (const s of signers) {
    await (await usdc.mint(s.address, won(10_000_000))).wait();
    await (await usdc.connect(s).approve(dep.ChainBuy, ethers.MaxUint256)).wait();
  }

  const now = await time.latest();
  const plan = [
    { target: 30, fill: 24, hours: 50 },
    { target: 20, fill: 17, hours: 10 },
    { target: 15, fill: 6, hours: 70 },
    { target: 10, fill: 8, hours: 20 },
    { target: 25, fill: 11, hours: 90 },
    { target: 12, fill: 3, hours: 30 },
    { target: 40, fill: 31, hours: 60 },
    { target: 10, fill: 10, hours: 40 }, // 목표 달성 → 결제·배송까지 진행
    { target: 20, fill: 9, hours: 80 },
    { target: 30, fill: 22, hours: 15 },
    { target: 15, fill: 12, hours: 45 },
    { target: 20, fill: 5, hours: 100 },
    { target: 12, fill: 10, hours: 22 },
    { target: 25, fill: 14, hours: 65 },
    { target: 20, fill: 16, hours: 35 },
    { target: 30, fill: 7, hours: 120 },
  ];

  for (let i = 0; i < catalog.products.length && i < plan.length; i++) {
    const p = catalog.products[i];
    const c = plan[i];
    await (
      await cb.connect(seller).createListedGroup(ethers.id(p.seller), {
        productHash: ethers.id(p.id),
        maxPrice: won(p.price),
        targetQty: c.target,
        maxPerUser: 3,
        deadline: now + c.hours * 3600,
      })
    ).wait();
    const id = await cb.groupCount();

    let left = c.fill;
    for (let b = 0; left > 0; b = (b + 1) % buyers.length) {
      const q = Math.min(left, 1 + ((b + i) % 3));
      const mine = await cb.getParticipant(id, buyers[b].address);
      if (Number(mine.qty) + q > 3) continue;
      await (await cb.connect(buyers[b]).deposit(id, q, ethers.id(`addr:${buyers[b].address}`))).wait();
      left -= q;
    }

    if (c.fill === c.target) {
      await (await cb.finalize(id)).wait();
      await (await cb.connect(agent).submitCheck(id, won(Math.round(p.price * 0.95)), ethers.id("check"))).wait();
      await (await cb.connect(reviewer).approve(id)).wait();
      await (await cb.connect(agent).payListed(id)).wait();
      await (await cb.connect(agent).submitOrderProof(id, ethers.id(`order:${id}`))).wait();
      await (await cb.connect(agent).markShipped(id)).wait();
    }
    console.log(`#${id} ${p.name} ${c.fill}/${c.target}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
