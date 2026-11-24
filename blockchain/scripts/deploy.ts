import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * MockUSDC + ChainBuy 배포.
 * 로컬(hardhat/localhost)에서는 데모용 역할·판매자·허용 쇼핑몰까지 등록한다.
 * 결과 주소는 deployments/<network>.json 에 저장해 frontend·backend가 읽는다.
 */
async function main() {
  const [deployer, reviewer, agent, feeRecipient, seller, cardIssuer] = await ethers.getSigners();
  const FEE_BPS = 500; // 5%

  const usdc = await ethers.deployContract("MockUSDC");
  await usdc.waitForDeployment();

  const chainBuy = await ethers.deployContract("ChainBuy", [
    await usdc.getAddress(),
    deployer.address,
    (feeRecipient ?? deployer).address,
    FEE_BPS,
  ]);
  await chainBuy.waitForDeployment();

  const out: Record<string, unknown> = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    MockUSDC: await usdc.getAddress(),
    ChainBuy: await chainBuy.getAddress(),
    feeBps: FEE_BPS,
  };

  const isLocal = network.name === "hardhat" || network.name === "localhost";
  if (isLocal) {
    const sellerId = ethers.id("seller:demo");
    const merchantId = ethers.id("merchant:demo-mall");
    await (await chainBuy.grantRole(await chainBuy.REVIEWER_ROLE(), reviewer.address)).wait();
    await (await chainBuy.grantRole(await chainBuy.AGENT_ROLE(), agent.address)).wait();
    await (await chainBuy.connect(reviewer).setSeller(sellerId, seller.address, true)).wait();
    await (await chainBuy.setMerchant(merchantId, cardIssuer.address, true)).wait();
    Object.assign(out, {
      roles: { admin: deployer.address, reviewer: reviewer.address, agent: agent.address },
      demo: { sellerId, seller: seller.address, merchantId, cardIssuer: cardIssuer.address },
    });
  }

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
