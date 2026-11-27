import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, SELLER_ID } from "./fixture";

/** 한 사람이 "판매자 등록 → 공구 열기 → 결제 승인"을 혼자 해서 돈을 가져가는 길을 막는다 */
describe("08. 역할 분리 — 공구 담당자 · 입점 담당자 · 판매자 겸직 금지", () => {
  it("공구 담당자는 판매자를 등록할 수 없다 (입점 담당자만)", async () => {
    const { chainBuy, reviewer } = await loadFixture(deployFixture);
    await expect(chainBuy.connect(reviewer).setSeller(ethers.id("seller:mine"), reviewer.address, true))
      .to.be.revertedWithCustomError(chainBuy, "AccessControlUnauthorizedAccount")
      .withArgs(reviewer.address, await chainBuy.SELLER_MANAGER_ROLE());
  });

  it("공구 담당자 · 입점 담당자 · 에이전트 지갑은 판매자로 등록할 수 없다", async () => {
    const { chainBuy, sellerManager, reviewer, agent } = await loadFixture(deployFixture);
    for (const staff of [reviewer, sellerManager, agent]) {
      await expect(chainBuy.connect(sellerManager).setSeller(ethers.id("seller:staff"), staff.address, true))
        .to.be.revertedWithCustomError(chainBuy, "RoleConflict")
        .withArgs(staff.address);
    }
  });

  it("판매자로 등록된 적 있는 지갑은 담당자 · 에이전트가 될 수 없다 (정지된 뒤에도)", async () => {
    const { chainBuy, admin, sellerManager, seller } = await loadFixture(deployFixture);
    await chainBuy.connect(sellerManager).setSeller(SELLER_ID, seller.address, false);
    for (const role of [await chainBuy.REVIEWER_ROLE(), await chainBuy.SELLER_MANAGER_ROLE(), await chainBuy.AGENT_ROLE()]) {
      await expect(chainBuy.connect(admin).grantRole(role, seller.address))
        .to.be.revertedWithCustomError(chainBuy, "RoleConflict")
        .withArgs(seller.address);
    }
  });

  it("직원 역할(공구 담당자 · 입점 담당자 · 에이전트)은 한 지갑이 겸할 수 없다", async () => {
    const { chainBuy, admin, reviewer, sellerManager, agent } = await loadFixture(deployFixture);
    const roles = {
      reviewer: await chainBuy.REVIEWER_ROLE(),
      sellerManager: await chainBuy.SELLER_MANAGER_ROLE(),
      agent: await chainBuy.AGENT_ROLE(),
    };
    const attempts: [typeof reviewer, string][] = [
      [reviewer, roles.sellerManager], // 담당자가 자기 판매자를 만드는 것
      [reviewer, roles.agent], // 담당자가 AI 검증을 꾸미는 것
      [sellerManager, roles.reviewer],
      [agent, roles.reviewer],
    ];
    for (const [wallet, role] of attempts) {
      await expect(chainBuy.connect(admin).grantRole(role, wallet.address))
        .to.be.revertedWithCustomError(chainBuy, "RoleConflict")
        .withArgs(wallet.address);
    }
  });

  it("이미 가진 역할을 다시 부여하는 것은 막지 않는다", async () => {
    const { chainBuy, admin, reviewer } = await loadFixture(deployFixture);
    await chainBuy.connect(admin).grantRole(await chainBuy.REVIEWER_ROLE(), reviewer.address);
    expect(await chainBuy.hasRole(await chainBuy.REVIEWER_ROLE(), reviewer.address)).to.equal(true);
  });

  it("역할을 내려놓으면 다른 역할을 받을 수 있다 (판매자였던 지갑은 제외)", async () => {
    const { chainBuy, admin, reviewer } = await loadFixture(deployFixture);
    await chainBuy.connect(admin).revokeRole(await chainBuy.REVIEWER_ROLE(), reviewer.address);
    await chainBuy.connect(admin).grantRole(await chainBuy.SELLER_MANAGER_ROLE(), reviewer.address);
    expect(await chainBuy.hasRole(await chainBuy.SELLER_MANAGER_ROLE(), reviewer.address)).to.equal(true);
  });
});
