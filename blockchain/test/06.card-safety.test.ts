import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, Status, DAY } from "./fixture";

/** 외부 상품 공구를 카드 충전(30,000)까지 진행. 1인 10,500 예치 × 3명 */
async function fundedExternal() {
  const f = await loadFixture(deployFixture);
  const id = await f.createExternal();
  await f.fillAndFinalize(id);
  await f.checkAndApprove(id);
  await f.chainBuy.connect(f.agent).fundCard(id, 30_000n);
  return { ...f, id };
}

describe("06. 경로 B 안전장치 — 카드 미반환 타임아웃 · 쇼핑몰 환불 반환 (PB-06)", () => {
  describe("settleCardTimeout", () => {
    it("충전 후 3일 전에는 호출할 수 없다", async () => {
      const { chainBuy, mallory, id } = await fundedExternal();
      await expect(chainBuy.connect(mallory).settleCardTimeout(id)).to.be.revertedWithCustomError(chainBuy, "ReturnWindowOpen");
    });

    it("3일이 지나면 누구나 충전액 전부를 결제액으로 확정하고, 배송 단계로 갈 수 있다", async () => {
      const { chainBuy, agent, mallory, alice, id } = await fundedExternal();
      await time.increase(3n * DAY + 1n);
      await expect(chainBuy.connect(mallory).settleCardTimeout(id))
        .to.emit(chainBuy, "CardSettledByTimeout")
        .withArgs(id, 30_000n);

      const g = await chainBuy.getGroup(id);
      expect(g.remainderReturned).to.equal(true);
      expect(g.actualGross).to.equal(30_000n);
      // 최대 가격 전부 결제된 것으로 보므로 차액 없음
      expect(await chainBuy.refundableAmount(id, alice.address)).to.equal(0n);

      await chainBuy.connect(agent).submitOrderProof(id, ethers.id("order-1"));
      await expect(chainBuy.connect(agent).markShipped(id)).to.emit(chainBuy, "Shipped");
    });

    it("이미 잔액이 반환된 공구에는 쓸 수 없다", async () => {
      const { chainBuy, cardIssuer, mallory, id } = await fundedExternal();
      await chainBuy.connect(cardIssuer).returnRemainder(id, 3_000n);
      await time.increase(3n * DAY + 1n);
      await expect(chainBuy.connect(mallory).settleCardTimeout(id)).to.be.revertedWithCustomError(chainBuy, "RemainderPending");
    });

    it("타임아웃 정산 뒤 카드 발급사가 돈을 돌려주면 참여자가 차액을 받는다", async () => {
      const { chainBuy, token, cardIssuer, alice, id } = await fundedExternal();
      await time.increase(3n * DAY + 1n);
      await chainBuy.settleCardTimeout(id);
      await chainBuy.connect(cardIssuer).returnRefund(id, 3_000n); // 실제 결제 27,000
      await expect(chainBuy.connect(alice).refund(id)).to.changeTokenBalance(token, alice, 1_050n);
    });
  });

  describe("returnRefund", () => {
    it("이미 차액을 받은 참여자도 쇼핑몰 환불 반환분을 추가로 받는다", async () => {
      const { chainBuy, token, cardIssuer, alice, bob, id } = await fundedExternal();
      await chainBuy.connect(cardIssuer).returnRemainder(id, 3_000n); // 결제 27,000
      await expect(chainBuy.connect(alice).refund(id)).to.changeTokenBalance(token, alice, 1_050n);

      // 일부 주문 취소: 9,000 환불 → 결제 18,000 · 1인 6,000 + 수수료 300
      await expect(chainBuy.connect(cardIssuer).returnRefund(id, 9_000n))
        .to.emit(chainBuy, "OrderRefundReturned")
        .withArgs(id, 9_000n, 18_000n);

      expect(await chainBuy.refundableAmount(id, alice.address)).to.equal(3_150n);
      await expect(chainBuy.connect(alice).refund(id)).to.changeTokenBalance(token, alice, 3_150n);
      await expect(chainBuy.connect(bob).refund(id)).to.changeTokenBalance(token, bob, 4_200n);
      expect(await chainBuy.refundedAmount(id, alice.address)).to.equal(4_200n);

      // 더 받을 게 없으면 거부
      await expect(chainBuy.connect(alice).refund(id)).to.be.revertedWithCustomError(chainBuy, "AlreadyRefunded");
    });

    it("전액 환불되면 공구가 취소되고, 각자 이미 받은 것을 뺀 예치금 전부를 받는다", async () => {
      const { chainBuy, token, cardIssuer, alice, bob, carol, id } = await fundedExternal();
      await chainBuy.connect(cardIssuer).returnRemainder(id, 3_000n);
      await chainBuy.connect(alice).refund(id); // 1,050

      await expect(chainBuy.connect(cardIssuer).returnRefund(id, 27_000n)).to.emit(chainBuy, "Cancelled").withArgs(id);
      expect((await chainBuy.getGroup(id)).status).to.equal(Status.CANCELLED);

      await expect(chainBuy.connect(alice).refund(id)).to.changeTokenBalance(token, alice, 9_450n);
      await expect(chainBuy.connect(bob).refund(id)).to.changeTokenBalance(token, bob, 10_500n);
      await expect(chainBuy.connect(carol).refund(id)).to.changeTokenBalance(token, carol, 10_500n);
      expect(await token.balanceOf(await chainBuy.getAddress())).to.equal(0n);
    });

    it("카드 충전 주소만, 잔액 반환 뒤, 결제액 이하로, 배송 완료 전에만 호출할 수 있다", async () => {
      const { chainBuy, agent, cardIssuer, mallory, id } = await fundedExternal();
      await expect(chainBuy.connect(cardIssuer).returnRefund(id, 1_000n)).to.be.revertedWithCustomError(chainBuy, "RemainderPending");

      await chainBuy.connect(cardIssuer).returnRemainder(id, 3_000n);
      await expect(chainBuy.connect(mallory).returnRefund(id, 1_000n)).to.be.revertedWithCustomError(chainBuy, "NotPayee");
      await expect(chainBuy.connect(cardIssuer).returnRefund(id, 27_001n)).to.be.revertedWithCustomError(chainBuy, "OverLimit");
      await expect(chainBuy.connect(cardIssuer).returnRefund(id, 0n)).to.be.revertedWithCustomError(chainBuy, "OverLimit");

      await chainBuy.connect(agent).submitOrderProof(id, ethers.id("order-2"));
      await chainBuy.connect(agent).markShipped(id);
      await expect(chainBuy.connect(cardIssuer).returnRefund(id, 1_000n))
        .to.be.revertedWithCustomError(chainBuy, "WrongStatus")
        .withArgs(Status.SHIPPED);
    });
  });
});
