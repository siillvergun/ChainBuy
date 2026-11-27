import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, Status } from "./fixture";

describe("03. 결제 (경로 A · 경로 B) · 차액 환불", () => {
  describe("경로 A — 입점 판매자", () => {
    it("판매자 지갑으로 (확인 가격 × 수량 − 수수료 5%)를 즉시 보내고, 수수료는 컨트랙트에 보관한다 (PA-01)", async () => {
      // 명세서 5-4 예시: 최대 10,000 · 실제 9,000 · 3명 · 5%
      const { chainBuy, token, agent, seller, createListed, fillAndFinalize, checkAndApprove } =
        await loadFixture(deployFixture);
      const id = await createListed();
      await fillAndFinalize(id);
      await checkAndApprove(id);

      await expect(chainBuy.connect(agent).payListed(id))
        .to.emit(chainBuy, "Paid")
        .withArgs(id, seller.address, 25_650n, 1_350n);
      expect(await token.balanceOf(seller.address)).to.equal(25_650n);
      const g = await chainBuy.getGroup(id);
      expect(g.status).to.equal(Status.PAID);
      expect(g.actualGross).to.equal(27_000n);
    });

    it("참여자는 차액 1,000을 환불받고, 입점 상품은 구매자 수수료가 없다 (RF-04)", async () => {
      const { chainBuy, token, agent, alice, bob, carol, createListed, fillAndFinalize, checkAndApprove } =
        await loadFixture(deployFixture);
      const id = await createListed();
      await fillAndFinalize(id);
      await checkAndApprove(id);
      await chainBuy.connect(agent).payListed(id);

      expect(await chainBuy.refundableAmount(id, alice.address)).to.equal(1_000n);
      expect(await chainBuy.feeOf(id, alice.address)).to.equal(450n);
      for (const u of [alice, bob, carol]) {
        await expect(chainBuy.connect(u).refund(id)).to.changeTokenBalance(token, u, 1_000n);
      }
      // 남은 잔액 = 보관 수수료 3몫
      expect(await token.balanceOf(await chainBuy.getAddress())).to.equal(1_350n);
    });

    it("확인 가격이 최대 가격과 같으면 환불할 차액이 없다", async () => {
      const { chainBuy, agent, alice, createListed, fillAndFinalize, checkAndApprove } =
        await loadFixture(deployFixture);
      const id = await createListed();
      await fillAndFinalize(id);
      await checkAndApprove(id, 10_000n);
      await chainBuy.connect(agent).payListed(id);
      expect(await chainBuy.refundableAmount(id, alice.address)).to.equal(0n);
      await expect(chainBuy.connect(alice).refund(id)).to.be.revertedWithCustomError(chainBuy, "NothingToRefund");
    });

    it("외부 상품 공구에는 경로 A 결제를 쓸 수 없다", async () => {
      const { chainBuy, agent, createExternal, fillAndFinalize, checkAndApprove } = await loadFixture(deployFixture);
      const id = await createExternal();
      await fillAndFinalize(id);
      await checkAndApprove(id);
      await expect(chainBuy.connect(agent).payListed(id)).to.be.revertedWithCustomError(chainBuy, "WrongKind");
    });
  });

  describe("경로 B — 일회용 가상카드", () => {
    it("카드 충전 → 잔액 반환 → 차액(수수료 차액 포함) 1,050 환불 (PB-02, PB-05, RF-04)", async () => {
      const { chainBuy, token, agent, cardIssuer, alice, bob, carol, createExternal, fillAndFinalize, checkAndApprove } =
        await loadFixture(deployFixture);
      const id = await createExternal();
      await fillAndFinalize(id); // 1인 10,500 예치, 총 31,500
      await checkAndApprove(id);

      // 한도(10,000 × 3)까지 충전
      await expect(chainBuy.connect(agent).fundCard(id, 30_000n))
        .to.emit(chainBuy, "CardFunded")
        .withArgs(id, cardIssuer.address, 30_000n);

      // 반환 전에는 실제 결제액을 몰라 환불 불가
      expect(await chainBuy.refundableAmount(id, alice.address)).to.equal(0n);
      await expect(chainBuy.connect(alice).refund(id)).to.be.revertedWithCustomError(chainBuy, "RemainderPending");

      // 카드로 27,000 결제, 3,000 반환
      await expect(chainBuy.connect(cardIssuer).returnRemainder(id, 3_000n))
        .to.emit(chainBuy, "RemainderReturned")
        .withArgs(id, 3_000n, 27_000n);

      expect(await chainBuy.feeOf(id, alice.address)).to.equal(450n);
      for (const u of [alice, bob, carol]) {
        await expect(chainBuy.connect(u).refund(id)).to.changeTokenBalance(token, u, 1_050n);
      }
      expect(await token.balanceOf(await chainBuy.getAddress())).to.equal(1_350n);
    });

    it("한도를 넘는 충전과 0원 충전은 거부한다 (INV-3)", async () => {
      const { chainBuy, agent, createExternal, fillAndFinalize, checkAndApprove } = await loadFixture(deployFixture);
      const id = await createExternal();
      await fillAndFinalize(id);
      await checkAndApprove(id);
      await expect(chainBuy.connect(agent).fundCard(id, 30_001n)).to.be.revertedWithCustomError(chainBuy, "OverLimit");
      await expect(chainBuy.connect(agent).fundCard(id, 0n)).to.be.revertedWithCustomError(chainBuy, "OverLimit");
    });

    it("잔액 반환은 카드 충전 주소만, 한 번만, 충전액 이하로만 가능하다", async () => {
      const { chainBuy, agent, cardIssuer, mallory, createExternal, fillAndFinalize, checkAndApprove } =
        await loadFixture(deployFixture);
      const id = await createExternal();
      await fillAndFinalize(id);
      await checkAndApprove(id);
      await chainBuy.connect(agent).fundCard(id, 30_000n);

      await expect(chainBuy.connect(mallory).returnRemainder(id, 1n)).to.be.revertedWithCustomError(
        chainBuy,
        "NotPayee"
      );
      await expect(chainBuy.connect(cardIssuer).returnRemainder(id, 30_001n)).to.be.revertedWithCustomError(
        chainBuy,
        "OverLimit"
      );
      await chainBuy.connect(cardIssuer).returnRemainder(id, 0n);
      await expect(chainBuy.connect(cardIssuer).returnRemainder(id, 0n)).to.be.revertedWithCustomError(
        chainBuy,
        "RemainderPending"
      );
    });

    it("카드 결제가 실패해 전액 반환되면 공구는 취소되고 전액 환불된다", async () => {
      const { chainBuy, token, agent, cardIssuer, alice, createExternal, fillAndFinalize, checkAndApprove } =
        await loadFixture(deployFixture);
      const id = await createExternal();
      await fillAndFinalize(id);
      await checkAndApprove(id);
      await chainBuy.connect(agent).fundCard(id, 30_000n);
      await chainBuy.connect(cardIssuer).returnRemainder(id, 30_000n);
      expect((await chainBuy.getGroup(id)).status).to.equal(Status.CANCELLED);
      await expect(chainBuy.connect(alice).refund(id)).to.changeTokenBalance(token, alice, 10_500n);
    });

    it("나누어떨어지지 않는 금액도 컨트랙트 잔액이 부족해지지 않는다 (INV-7)", async () => {
      const { chainBuy, token, agent, cardIssuer, alice, bob, carol, createExternal, fillAndFinalize, checkAndApprove } =
        await loadFixture(deployFixture);
      const id = await createExternal();
      await fillAndFinalize(id);
      await checkAndApprove(id);
      await chainBuy.connect(agent).fundCard(id, 30_000n);
      await chainBuy.connect(cardIssuer).returnRemainder(id, 20_000n); // 실제 10,000 ÷ 3명

      // 1인 몫 = 올림(10,000 / 3) = 3,334, 수수료 = 166, 환불 = 10,500 − 3,334 − 166 = 7,000
      for (const u of [alice, bob, carol]) {
        await expect(chainBuy.connect(u).refund(id)).to.changeTokenBalance(token, u, 7_000n);
      }
      const cb = await chainBuy.getAddress();
      const fees = (await chainBuy.feeOf(id, alice.address)) * 3n;
      expect(await token.balanceOf(cb)).to.be.greaterThanOrEqual(fees);
    });

    it("입점 상품 공구에는 카드 충전을 쓸 수 없고, 승인 전에는 결제할 수 없다", async () => {
      const { chainBuy, agent, createListed, createExternal, fillAndFinalize, checkAndApprove } =
        await loadFixture(deployFixture);
      const listed = await createListed();
      await fillAndFinalize(listed);
      await checkAndApprove(listed);
      await expect(chainBuy.connect(agent).fundCard(listed, 1n)).to.be.revertedWithCustomError(chainBuy, "WrongKind");

      const ext = await createExternal();
      await expect(chainBuy.connect(agent).fundCard(ext, 1n)).to.be.revertedWithCustomError(chainBuy, "WrongStatus");
    });
  });
});
