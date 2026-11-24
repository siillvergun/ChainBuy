import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, Status, DAY } from "./fixture";

describe("04. 주문 증거 · 배송 · 수령 확인 · 이의 · 수수료 지급", () => {
  /** 입점 상품 공구를 결제·주문 증거 제출까지 진행 */
  async function paidListed() {
    const f = await loadFixture(deployFixture);
    const id = await f.createListed();
    await f.fillAndFinalize(id);
    await f.checkAndApprove(id);
    await f.chainBuy.connect(f.agent).payListed(id);
    return { ...f, id };
  }

  async function shippedListed() {
    const f = await paidListed();
    await f.chainBuy.connect(f.agent).submitOrderProof(f.id, ethers.id("order-1001"));
    await f.chainBuy.connect(f.agent).markShipped(f.id);
    return f;
  }

  describe("주문 증거·배송", () => {
    it("주문번호 해시를 기록하고, 같은 해시는 다른 공구에 다시 쓸 수 없다 (DL-01, DL-02)", async () => {
      const f = await paidListed();
      await expect(f.chainBuy.connect(f.agent).submitOrderProof(f.id, ethers.id("order-1001")))
        .to.emit(f.chainBuy, "OrderProofSubmitted")
        .withArgs(f.id, ethers.id("order-1001"));
      expect(await f.chainBuy.usedOrderHash(ethers.id("order-1001"))).to.equal(true);

      // 같은 공구에 두 번째 증거도 불가
      await expect(
        f.chainBuy.connect(f.agent).submitOrderProof(f.id, ethers.id("order-1002"))
      ).to.be.revertedWithCustomError(f.chainBuy, "OrderHashUsed");

      // 다른 공구에서 같은 주문번호 재사용 불가
      const id2 = await f.createListed();
      await f.fillAndFinalize(id2);
      await f.checkAndApprove(id2);
      await f.chainBuy.connect(f.agent).payListed(id2);
      await expect(
        f.chainBuy.connect(f.agent).submitOrderProof(id2, ethers.id("order-1001"))
      ).to.be.revertedWithCustomError(f.chainBuy, "OrderHashUsed");
    });

    it("빈 주문 해시는 받지 않는다", async () => {
      const f = await paidListed();
      await expect(f.chainBuy.connect(f.agent).submitOrderProof(f.id, ethers.ZeroHash)).to.be.revertedWithCustomError(
        f.chainBuy,
        "OrderHashUsed"
      );
    });

    it("주문 증거가 있어야 배송 완료를 기록할 수 있다 (DL-05)", async () => {
      const f = await paidListed();
      await expect(f.chainBuy.connect(f.agent).markShipped(f.id)).to.be.revertedWithCustomError(
        f.chainBuy,
        "OrderProofMissing"
      );
      await f.chainBuy.connect(f.agent).submitOrderProof(f.id, ethers.id("order-1001"));
      await expect(f.chainBuy.connect(f.agent).markShipped(f.id)).to.emit(f.chainBuy, "Shipped");
      expect((await f.chainBuy.getGroup(f.id)).status).to.equal(Status.SHIPPED);
    });

    it("경로 B는 카드 잔액이 반환돼야 배송 완료를 기록할 수 있다", async () => {
      const f = await loadFixture(deployFixture);
      const id = await f.createExternal();
      await f.fillAndFinalize(id);
      await f.checkAndApprove(id);
      await f.chainBuy.connect(f.agent).fundCard(id, 30_000n);
      await f.chainBuy.connect(f.agent).submitOrderProof(id, ethers.id("ext-order"));
      await expect(f.chainBuy.connect(f.agent).markShipped(id)).to.be.revertedWithCustomError(
        f.chainBuy,
        "RemainderPending"
      );
      await f.chainBuy.connect(f.cardIssuer).returnRemainder(id, 3_000n);
      await f.chainBuy.connect(f.agent).markShipped(id);
    });

    it("결제 전에는 주문 증거·배송을 기록할 수 없다", async () => {
      const f = await loadFixture(deployFixture);
      const id = await f.createListed();
      await expect(f.chainBuy.connect(f.agent).submitOrderProof(id, ethers.id("x"))).to.be.revertedWithCustomError(
        f.chainBuy,
        "WrongStatus"
      );
      await expect(f.chainBuy.connect(f.agent).markShipped(id)).to.be.revertedWithCustomError(
        f.chainBuy,
        "WrongStatus"
      );
    });
  });

  describe("수령 확인·수수료 지급", () => {
    it("수령 확인한 몫은 바로 수수료를 지급할 수 있다 (FEE-03, FEE-05)", async () => {
      const f = await shippedListed();
      await expect(f.chainBuy.connect(f.alice).confirmReceipt(f.id))
        .to.emit(f.chainBuy, "ReceiptConfirmed")
        .withArgs(f.id, f.alice.address);
      // 아무나(여기서는 mallory) 지급 함수를 호출해도 돈은 플랫폼 수수료 주소로만 간다
      await expect(f.chainBuy.connect(f.mallory).releaseFee(f.id, f.alice.address)).to.changeTokenBalance(
        f.usdc,
        f.feeRecipient,
        450n
      );
      await expect(f.chainBuy.releaseFee(f.id, f.alice.address)).to.be.revertedWithCustomError(
        f.chainBuy,
        "FeeNotReleasable"
      );
    });

    it("수령 확인이 없으면 7일이 지나야 지급된다 (FEE-04)", async () => {
      const f = await shippedListed();
      await expect(f.chainBuy.releaseFee(f.id, f.bob.address)).to.be.revertedWithCustomError(
        f.chainBuy,
        "FeeNotReleasable"
      );
      await time.increase(7n * DAY + 1n);
      await expect(f.chainBuy.releaseFee(f.id, f.bob.address)).to.changeTokenBalance(f.usdc, f.feeRecipient, 450n);
    });

    it("수용 기준: 2명 수령 확인 + 1명 7일 경과 → 수수료 3몫 지급, 공구 완료", async () => {
      const f = await shippedListed();
      await f.chainBuy.connect(f.alice).confirmReceipt(f.id);
      await f.chainBuy.connect(f.bob).confirmReceipt(f.id);
      await f.chainBuy.releaseFee(f.id, f.alice.address);
      await f.chainBuy.releaseFee(f.id, f.bob.address);
      await time.increase(7n * DAY + 1n);
      await expect(f.chainBuy.releaseFee(f.id, f.carol.address)).to.emit(f.chainBuy, "Completed").withArgs(f.id);

      expect(await f.usdc.balanceOf(f.feeRecipient.address)).to.equal(1_350n);
      expect((await f.chainBuy.getGroup(f.id)).status).to.equal(Status.COMPLETED);

      // 완료 후에도 차액 환불은 받을 수 있다
      await expect(f.chainBuy.connect(f.alice).refund(f.id)).to.changeTokenBalance(f.usdc, f.alice, 1_000n);
    });

    it("이미 응답한 참여자는 다시 확인·이의할 수 없고, 비참여자는 아무것도 할 수 없다", async () => {
      const f = await shippedListed();
      await f.chainBuy.connect(f.alice).confirmReceipt(f.id);
      await expect(f.chainBuy.connect(f.alice).confirmReceipt(f.id)).to.be.revertedWithCustomError(
        f.chainBuy,
        "ReceiptAlreadySet"
      );
      await expect(f.chainBuy.connect(f.alice).dispute(f.id, ethers.ZeroHash)).to.be.revertedWithCustomError(
        f.chainBuy,
        "ReceiptAlreadySet"
      );
      await expect(f.chainBuy.connect(f.mallory).confirmReceipt(f.id)).to.be.revertedWithCustomError(
        f.chainBuy,
        "NotParticipant"
      );
      await expect(f.chainBuy.connect(f.mallory).dispute(f.id, ethers.ZeroHash)).to.be.revertedWithCustomError(
        f.chainBuy,
        "NotParticipant"
      );
      await expect(f.chainBuy.releaseFee(f.id, f.mallory.address)).to.be.revertedWithCustomError(
        f.chainBuy,
        "NotParticipant"
      );
    });

    it("배송 전에는 수령 확인·이의·수수료 지급이 안 된다", async () => {
      const f = await paidListed();
      await expect(f.chainBuy.connect(f.alice).confirmReceipt(f.id)).to.be.revertedWithCustomError(
        f.chainBuy,
        "WrongStatus"
      );
      await expect(f.chainBuy.connect(f.alice).dispute(f.id, ethers.ZeroHash)).to.be.revertedWithCustomError(
        f.chainBuy,
        "WrongStatus"
      );
      await expect(f.chainBuy.releaseFee(f.id, f.alice.address)).to.be.revertedWithCustomError(
        f.chainBuy,
        "WrongStatus"
      );
    });

    it("경로 B도 같은 방식으로 수수료가 지급된다", async () => {
      const f = await loadFixture(deployFixture);
      const id = await f.createExternal();
      await f.fillAndFinalize(id);
      await f.checkAndApprove(id);
      await f.chainBuy.connect(f.agent).fundCard(id, 30_000n);
      await f.chainBuy.connect(f.cardIssuer).returnRemainder(id, 3_000n);
      await f.chainBuy.connect(f.agent).submitOrderProof(id, ethers.id("ext-order"));
      await f.chainBuy.connect(f.agent).markShipped(id);
      await f.chainBuy.connect(f.alice).confirmReceipt(id);
      await expect(f.chainBuy.releaseFee(id, f.alice.address)).to.changeTokenBalance(f.usdc, f.feeRecipient, 450n);
    });
  });

  describe("이의 제기", () => {
    it("이의를 제기하면 수수료가 보류되고, 7일이 지나도 자동 지급되지 않는다 (DSP-01, DSP-02)", async () => {
      const f = await shippedListed();
      await expect(f.chainBuy.connect(f.alice).dispute(f.id, ethers.id("broken item")))
        .to.emit(f.chainBuy, "Disputed")
        .withArgs(f.id, f.alice.address, ethers.id("broken item"));
      await time.increase(7n * DAY + 1n);
      await expect(f.chainBuy.releaseFee(f.id, f.alice.address)).to.be.revertedWithCustomError(
        f.chainBuy,
        "FeeNotReleasable"
      );
    });

    it("이의가 인정되면 보류된 수수료 몫을 참여자에게 준다 (DSP-03)", async () => {
      const f = await shippedListed();
      await f.chainBuy.connect(f.alice).dispute(f.id, ethers.id("broken item"));
      await expect(f.chainBuy.connect(f.reviewer).resolveDispute(f.id, f.alice.address, true))
        .to.emit(f.chainBuy, "DisputeResolved")
        .withArgs(f.id, f.alice.address, true, 450n);
      // (차액 1,000은 refund로 따로 받는다)
      expect(await f.usdc.balanceOf(f.feeRecipient.address)).to.equal(0n);
    });

    it("이의가 기각되면 수수료는 플랫폼에 지급된다", async () => {
      const f = await shippedListed();
      await f.chainBuy.connect(f.alice).dispute(f.id, ethers.id("changed mind"));
      await expect(f.chainBuy.connect(f.reviewer).resolveDispute(f.id, f.alice.address, false)).to.changeTokenBalance(
        f.usdc,
        f.feeRecipient,
        450n
      );
      await expect(
        f.chainBuy.connect(f.reviewer).resolveDispute(f.id, f.alice.address, true)
      ).to.be.revertedWithCustomError(f.chainBuy, "FeeNotReleasable");
    });

    it("이의 기간 7일이 지나면 이의를 제기할 수 없다", async () => {
      const f = await shippedListed();
      await time.increase(7n * DAY + 1n);
      await expect(f.chainBuy.connect(f.alice).dispute(f.id, ethers.ZeroHash)).to.be.revertedWithCustomError(
        f.chainBuy,
        "DisputeWindowClosed"
      );
    });

    it("이의 처리는 담당자만, 이의가 있는 참여자에 대해서만 가능하다", async () => {
      const f = await shippedListed();
      await expect(
        f.chainBuy.connect(f.mallory).resolveDispute(f.id, f.alice.address, true)
      ).to.be.revertedWithCustomError(f.chainBuy, "AccessControlUnauthorizedAccount");
      await expect(
        f.chainBuy.connect(f.reviewer).resolveDispute(f.id, f.alice.address, true)
      ).to.be.revertedWithCustomError(f.chainBuy, "FeeNotReleasable");
    });
  });
});
