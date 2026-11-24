import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, Status, MAX_PRICE, CHECKED_PRICE, DAY } from "./fixture";

describe("02. AI 확인 · 담당자 승인 · 취소", () => {
  it("AI 확인 결과를 제출하고 담당자가 승인한다 (AI-03, AI-05)", async () => {
    const { chainBuy, agent, reviewer, createListed, fillAndFinalize } = await loadFixture(deployFixture);
    const id = await createListed();
    await fillAndFinalize(id);
    await expect(chainBuy.connect(agent).submitCheck(id, CHECKED_PRICE, ethers.id("r")))
      .to.emit(chainBuy, "CheckSubmitted")
      .withArgs(id, CHECKED_PRICE, ethers.id("r"));
    await expect(chainBuy.connect(reviewer).approve(id)).to.emit(chainBuy, "Approved").withArgs(id);
    const g = await chainBuy.getGroup(id);
    expect(g.status).to.equal(Status.APPROVED);
    expect(g.checkedPrice).to.equal(CHECKED_PRICE);
  });

  it("AI 확인 없이는 승인할 수 없다 (결제는 AI + 담당자 둘 다 필요)", async () => {
    const { chainBuy, reviewer, createListed, fillAndFinalize } = await loadFixture(deployFixture);
    const id = await createListed();
    await fillAndFinalize(id);
    await expect(chainBuy.connect(reviewer).approve(id)).to.be.revertedWithCustomError(chainBuy, "CheckMissing");
  });

  it("최대 가격을 넘는 확인 가격은 제출할 수 없고, 0원도 안 된다 (AI-04)", async () => {
    const { chainBuy, agent, createListed, fillAndFinalize } = await loadFixture(deployFixture);
    const id = await createListed();
    await fillAndFinalize(id);
    await expect(
      chainBuy.connect(agent).submitCheck(id, MAX_PRICE + 1n, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(chainBuy, "PriceTooHigh");
    await expect(chainBuy.connect(agent).submitCheck(id, 0, ethers.ZeroHash)).to.be.revertedWithCustomError(
      chainBuy,
      "InvalidParams"
    );
  });

  it("역할이 없는 사람은 확인 제출·승인·거절을 할 수 없다", async () => {
    const { chainBuy, agent, mallory, createListed, fillAndFinalize } = await loadFixture(deployFixture);
    const id = await createListed();
    await fillAndFinalize(id);
    await expect(
      chainBuy.connect(mallory).submitCheck(id, CHECKED_PRICE, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(chainBuy, "AccessControlUnauthorizedAccount");
    await chainBuy.connect(agent).submitCheck(id, CHECKED_PRICE, ethers.ZeroHash);
    await expect(chainBuy.connect(agent).approve(id)).to.be.revertedWithCustomError(
      chainBuy,
      "AccessControlUnauthorizedAccount"
    );
    await expect(chainBuy.connect(mallory).reject(id)).to.be.revertedWithCustomError(
      chainBuy,
      "AccessControlUnauthorizedAccount"
    );
  });

  it("확인 대기가 아니면 확인 제출·승인·거절이 안 된다", async () => {
    const { chainBuy, agent, reviewer, createListed } = await loadFixture(deployFixture);
    const id = await createListed();
    await expect(chainBuy.connect(agent).submitCheck(id, CHECKED_PRICE, ethers.ZeroHash)).to.be.revertedWithCustomError(
      chainBuy,
      "WrongStatus"
    );
    await expect(chainBuy.connect(reviewer).approve(id)).to.be.revertedWithCustomError(chainBuy, "WrongStatus");
    await expect(chainBuy.connect(reviewer).reject(id)).to.be.revertedWithCustomError(chainBuy, "WrongStatus");
  });

  it("담당자가 거절하면 취소되고 전액 환불된다 (RF-03)", async () => {
    const { chainBuy, usdc, reviewer, alice, createListed, fillAndFinalize } = await loadFixture(deployFixture);
    const id = await createListed();
    await fillAndFinalize(id);
    await chainBuy.connect(reviewer).reject(id);
    expect((await chainBuy.getGroup(id)).status).to.equal(Status.CANCELLED);
    await expect(chainBuy.connect(alice).refund(id)).to.changeTokenBalance(usdc, alice, MAX_PRICE);
  });

  it("가격 초과·품절이면 AI가 취소하고 전액 환불된다 (AI-04, RF-03)", async () => {
    const { chainBuy, usdc, agent, bob, createExternal, fillAndFinalize } = await loadFixture(deployFixture);
    const id = await createExternal();
    await fillAndFinalize(id);
    await expect(chainBuy.connect(agent).cancel(id)).to.emit(chainBuy, "Cancelled").withArgs(id);
    await expect(chainBuy.connect(bob).refund(id)).to.changeTokenBalance(usdc, bob, 10_500n);
  });

  it("승인 후에도 결제 전이면 담당자가 취소할 수 있다", async () => {
    const { chainBuy, reviewer, createListed, fillAndFinalize, checkAndApprove } = await loadFixture(deployFixture);
    const id = await createListed();
    await fillAndFinalize(id);
    await checkAndApprove(id);
    await chainBuy.connect(reviewer).cancel(id);
    expect((await chainBuy.getGroup(id)).status).to.equal(Status.CANCELLED);
  });

  it("승인 기한 7일 전에는 일반 사용자가 취소할 수 없고, 지나면 누구나 취소할 수 있다 (RF-05, NFR-05)", async () => {
    const { chainBuy, usdc, mallory, alice, createListed, fillAndFinalize, checkAndApprove } =
      await loadFixture(deployFixture);
    const id = await createListed();
    await fillAndFinalize(id);
    await checkAndApprove(id); // 승인됐지만 AI가 멈춰 결제가 안 된 상황

    await time.increase(7n * DAY - 10n);
    await expect(chainBuy.connect(mallory).cancel(id)).to.be.revertedWithCustomError(chainBuy, "Unauthorized");

    await time.increase(20n);
    await chainBuy.connect(mallory).cancel(id);
    await expect(chainBuy.connect(alice).refund(id)).to.changeTokenBalance(usdc, alice, MAX_PRICE);
  });

  it("결제가 끝난 공구는 취소할 수 없다", async () => {
    const { chainBuy, agent, reviewer, createListed, fillAndFinalize, checkAndApprove } =
      await loadFixture(deployFixture);
    const id = await createListed();
    await fillAndFinalize(id);
    await checkAndApprove(id);
    await chainBuy.connect(agent).payListed(id);
    await expect(chainBuy.connect(reviewer).cancel(id)).to.be.revertedWithCustomError(chainBuy, "WrongStatus");
  });
});
