import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

export const Status = {
  OPEN: 0n,
  FAILED: 1n,
  PENDING_CHECK: 2n,
  CANCELLED: 3n,
  APPROVED: 4n,
  PAID: 5n,
  SHIPPED: 6n,
  COMPLETED: 7n,
} as const;

export const Kind = { LISTED: 0n, EXTERNAL: 1n } as const;

export const SELLER_ID = ethers.id("seller:coffee-roasters");
export const MERCHANT_ID = ethers.id("merchant:big-mall");
export const FEE_BPS = 500n; // 5%
export const DAY = 24n * 60n * 60n;

// 명세서 5-4 예시와 같은 숫자 (토큰 최소 단위)
export const MAX_PRICE = 10_000n;
export const CHECKED_PRICE = 9_000n;

export async function deployFixture() {
  const [admin, reviewer, agent, feeRecipient, seller, cardIssuer, creator, alice, bob, carol, mallory] =
    await ethers.getSigners();

  const usdc = await ethers.deployContract("MockUSDC");
  const chainBuy = await ethers.deployContract("ChainBuy", [
    await usdc.getAddress(),
    admin.address,
    feeRecipient.address,
    FEE_BPS,
  ]);
  const cbAddr = await chainBuy.getAddress();

  await chainBuy.connect(admin).grantRole(await chainBuy.REVIEWER_ROLE(), reviewer.address);
  await chainBuy.connect(admin).grantRole(await chainBuy.AGENT_ROLE(), agent.address);
  await chainBuy.connect(reviewer).setSeller(SELLER_ID, seller.address, true);
  await chainBuy.connect(admin).setMerchant(MERCHANT_ID, cardIssuer.address, true);

  for (const u of [alice, bob, carol, mallory, cardIssuer]) {
    await usdc.mint(u.address, 1_000_000_000n);
    await usdc.connect(u).approve(cbAddr, ethers.MaxUint256);
  }

  async function params(overrides: Partial<{ maxPrice: bigint; targetQty: number; maxPerUser: number; days: bigint }> = {}) {
    const now = BigInt(await time.latest());
    return {
      productHash: ethers.id("https://example.com/product/1"),
      maxPrice: overrides.maxPrice ?? MAX_PRICE,
      targetQty: overrides.targetQty ?? 3,
      maxPerUser: overrides.maxPerUser ?? 2,
      deadline: now + (overrides.days ?? 3n) * DAY,
    };
  }

  async function createListed(overrides = {}) {
    await chainBuy.connect(seller).createListedGroup(SELLER_ID, await params(overrides));
    return await chainBuy.groupCount();
  }

  async function createExternal(overrides = {}) {
    await chainBuy.connect(reviewer).createExternalGroup(MERCHANT_ID, creator.address, await params(overrides));
    return await chainBuy.groupCount();
  }

  /** 3명이 1개씩 참여 → 목표 달성 → 확인 대기 */
  async function fillAndFinalize(id: bigint) {
    for (const u of [alice, bob, carol]) {
      await chainBuy.connect(u).deposit(id, 1, ethers.id(`addr:${u.address}`));
    }
    await chainBuy.finalize(id);
  }

  /** 확인 대기 → AI 확인 → 담당자 승인 */
  async function checkAndApprove(id: bigint, price = CHECKED_PRICE) {
    await chainBuy.connect(agent).submitCheck(id, price, ethers.id("check-result"));
    await chainBuy.connect(reviewer).approve(id);
  }

  return {
    usdc,
    chainBuy,
    admin,
    reviewer,
    agent,
    feeRecipient,
    seller,
    cardIssuer,
    creator,
    alice,
    bob,
    carol,
    mallory,
    params,
    createListed,
    createExternal,
    fillAndFinalize,
    checkAndApprove,
  };
}
