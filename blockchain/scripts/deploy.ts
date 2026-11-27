import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

/**
 * ChainBuyUSD + ChainBuy 배포.
 * - 로컬(hardhat/localhost): 데모용 역할·판매자·허용 쇼핑몰을 hardhat 테스트 계정으로 등록
 * - Sepolia 등: 역할·허용 쇼핑몰을 .env 주소(REVIEWER_ADDRESS, AGENT_ADDRESS, FEE_RECIPIENT,
 *   CARD_ISSUER_ADDRESS)로 등록, 비어 있으면 배포 지갑
 * - 계정 추상화(ERC-4337): EntryPoint(로컬은 새로 배포, Sepolia는 표준 주소) · 스마트 지갑 팩토리 · 가스비 대납 Paymaster
 * 결과(주소·배포 블록)는 deployments/<network>.json 에 저장해 frontend·backend가 읽는다.
 */
/** ERC-4337 v0.7 표준 EntryPoint (Sepolia 등 공개 네트워크에 같은 주소로 배포돼 있음) */
const SEPOLIA_ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

async function deployLocalEntryPoint(): Promise<string> {
  const entryPoint = await ethers.deployContract("EntryPoint");
  await entryPoint.waitForDeployment();
  return await entryPoint.getAddress();
}

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const isLocal = network.name === "hardhat" || network.name === "localhost";
  const FEE_BPS = 500; // 5%

  // 역할을 줄 주소
  const env = (k: string) => (process.env[k] ? ethers.getAddress(process.env[k]!) : deployer.address);
  // 직원 역할은 컨트랙트가 겸직을 막으므로 서로 다른 지갑이어야 한다 → 비워 둘 수 없음
  const required = (k: string) => {
    if (!process.env[k]) throw new Error(`${k}를 blockchain/.env에 넣어 주세요 (공구 담당자 · 입점 담당자 · 에이전트는 서로 다른 지갑)`);
    return ethers.getAddress(process.env[k]!);
  };
  const roles = isLocal
    ? {
        reviewer: signers[1].address,
        agent: signers[2].address,
        sellerManager: signers[19].address, // 입점 담당자 (판매자 등록만)
        feeRecipient: signers[3].address,
        seller: signers[4].address,
        cardIssuer: signers[5].address,
        sponsor: signers[7].address, // 백엔드: 가스 대납 서명 + 번들러 제출
      }
    : {
        reviewer: required("REVIEWER_ADDRESS"),
        agent: required("AGENT_ADDRESS"),
        sellerManager: required("SELLER_MANAGER_ADDRESS"),
        feeRecipient: env("FEE_RECIPIENT"),
        seller: null,
        cardIssuer: env("CARD_ISSUER_ADDRESS"),
        sponsor: env("SPONSOR_ADDRESS"),
      };

  const startBlock = await ethers.provider.getBlockNumber();
  const token = await ethers.deployContract("ChainBuyUSD");
  await token.waitForDeployment();
  const chainBuy = await ethers.deployContract("ChainBuy", [await token.getAddress(), deployer.address, roles.feeRecipient, FEE_BPS]);
  await chainBuy.waitForDeployment();

  const merchantId = ethers.id("merchant:demo-mall");
  await (await chainBuy.grantRole(await chainBuy.REVIEWER_ROLE(), roles.reviewer)).wait();
  await (await chainBuy.grantRole(await chainBuy.AGENT_ROLE(), roles.agent)).wait();
  await (await chainBuy.grantRole(await chainBuy.SELLER_MANAGER_ROLE(), roles.sellerManager)).wait();
  await (await chainBuy.setMerchant(merchantId, roles.cardIssuer, true)).wait();

  // ── 계정 추상화 ──
  const entryPointAddress = isLocal ? await deployLocalEntryPoint() : SEPOLIA_ENTRY_POINT;
  if ((await ethers.provider.getCode(entryPointAddress)) === "0x") throw new Error(`EntryPoint가 없어요: ${entryPointAddress}`);
  const accountFactory = await ethers.deployContract("SimpleAccountFactory", [entryPointAddress]);
  await accountFactory.waitForDeployment();
  const paymaster = await ethers.deployContract("ChainBuyPaymaster", [
    entryPointAddress,
    roles.sponsor,
    await chainBuy.getAddress(),
    await token.getAddress(),
  ]);
  await paymaster.waitForDeployment();
  // 가스비로 쓸 테스트넷 ETH를 EntryPoint에 맡겨 둔다 (로컬 10 ETH, Sepolia는 PAYMASTER_DEPOSIT_ETH, 기본 0.05)
  const paymasterDeposit = ethers.parseEther(isLocal ? "10" : process.env.PAYMASTER_DEPOSIT_ETH ?? "0.05");
  await (await paymaster.deposit({ value: paymasterDeposit })).wait();

  const out: Record<string, unknown> = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    ChainBuyUSD: await token.getAddress(),
    ChainBuy: await chainBuy.getAddress(),
    deployBlock: startBlock,
    feeBps: FEE_BPS,
    roles: {
      admin: deployer.address,
      reviewer: roles.reviewer,
      sellerManager: roles.sellerManager,
      agent: roles.agent,
      feeRecipient: roles.feeRecipient,
    },
    merchant: { merchantId, cardIssuer: roles.cardIssuer },
    accountAbstraction: {
      entryPoint: entryPointAddress,
      // 팩토리에는 같은 이름의 컨트랙트 함수 getAddress(owner, salt)가 있어서 배포 주소는 target으로 읽는다
      accountFactory: accountFactory.target as string,
      paymaster: await paymaster.getAddress(),
      sponsor: roles.sponsor,
    },
  };

  if (isLocal && roles.seller) {
    // 로컬 데모 판매자 (seed.ts가 이 판매자로 공구를 연다). 등록은 입점 담당자(SELLER_MANAGER)만 할 수 있다
    const sellerId = ethers.id("seller:demo");
    await (await chainBuy.connect(signers[19]).setSeller(sellerId, roles.seller, true)).wait();
    out.demo = { sellerId, seller: roles.seller };
  }

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  // 로컬 체인은 재시작할 때마다 주소가 새로 정해지므로 프론트의 컨트랙트 주소도 바로 갱신
  if (network.name === "localhost") {
    execFileSync("node", [path.join(__dirname, "..", "..", "frontend", "scripts", "sync-contracts.mjs")], { stdio: "inherit" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
