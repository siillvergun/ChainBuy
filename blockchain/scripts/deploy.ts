import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * MockUSDC + ChainBuy 배포.
 * - 로컬(hardhat/localhost): 데모용 역할·판매자·허용 쇼핑몰을 hardhat 테스트 계정으로 등록
 * - Sepolia 등: 역할·허용 쇼핑몰을 .env 주소(REVIEWER_ADDRESS, AGENT_ADDRESS, FEE_RECIPIENT,
 *   CARD_ISSUER_ADDRESS)로 등록, 비어 있으면 배포 지갑
 * 결과(주소·배포 블록)는 deployments/<network>.json 에 저장해 frontend·backend가 읽는다.
 */
async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const isLocal = network.name === "hardhat" || network.name === "localhost";
  const FEE_BPS = 500; // 5%

  // 역할을 줄 주소
  const env = (k: string) => (process.env[k] ? ethers.getAddress(process.env[k]!) : deployer.address);
  const roles = isLocal
    ? {
        reviewer: signers[1].address,
        agent: signers[2].address,
        feeRecipient: signers[3].address,
        seller: signers[4].address,
        cardIssuer: signers[5].address,
      }
    : {
        reviewer: env("REVIEWER_ADDRESS"),
        agent: env("AGENT_ADDRESS"),
        feeRecipient: env("FEE_RECIPIENT"),
        seller: null,
        cardIssuer: env("CARD_ISSUER_ADDRESS"),
      };

  const startBlock = await ethers.provider.getBlockNumber();
  const usdc = await ethers.deployContract("MockUSDC");
  await usdc.waitForDeployment();
  const chainBuy = await ethers.deployContract("ChainBuy", [await usdc.getAddress(), deployer.address, roles.feeRecipient, FEE_BPS]);
  await chainBuy.waitForDeployment();

  const merchantId = ethers.id("merchant:demo-mall");
  await (await chainBuy.grantRole(await chainBuy.REVIEWER_ROLE(), roles.reviewer)).wait();
  await (await chainBuy.grantRole(await chainBuy.AGENT_ROLE(), roles.agent)).wait();
  await (await chainBuy.setMerchant(merchantId, roles.cardIssuer, true)).wait();

  const out: Record<string, unknown> = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    MockUSDC: await usdc.getAddress(),
    ChainBuy: await chainBuy.getAddress(),
    deployBlock: startBlock,
    feeBps: FEE_BPS,
    roles: { admin: deployer.address, reviewer: roles.reviewer, agent: roles.agent, feeRecipient: roles.feeRecipient },
    merchant: { merchantId, cardIssuer: roles.cardIssuer },
  };

  if (isLocal && roles.seller) {
    // 로컬 데모 판매자 (seed.ts가 이 판매자로 공구를 연다). 등록은 REVIEWER만 할 수 있다
    const sellerId = ethers.id("seller:demo");
    await (await chainBuy.connect(signers[1]).setSeller(sellerId, roles.seller, true)).wait();
    out.demo = { sellerId, seller: roles.seller };
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
