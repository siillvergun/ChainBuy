import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, Status, Kind, SELLER_ID, MERCHANT_ID, MAX_PRICE, FEE_BPS, DAY } from "./fixture";

describe("01. 공구 생성 · 참여 · 마감 · 미달 환불", () => {
  describe("공구 생성", () => {
    it("입점 상품: 판매자가 열고, 결제 대상·수수료율이 등록부 값으로 고정된다 (GB-01, GB-04, GB-05)", async () => {
      const { chainBuy, seller, createListed } = await loadFixture(deployFixture);
      const id = await createListed();
      const g = await chainBuy.getGroup(id);
      expect(g.kind).to.equal(Kind.LISTED);
      expect(g.status).to.equal(Status.OPEN);
      expect(g.creator).to.equal(seller.address);
      expect(g.payee).to.equal(seller.address);
      expect(g.feeBps).to.equal(FEE_BPS);
    });

    it("외부 상품: 담당자만 생성할 수 있고, 결제 대상은 카드 충전 주소로 고정된다 (GB-02, LNK-05)", async () => {
      const { chainBuy, creator, cardIssuer, mallory, params, createExternal } = await loadFixture(deployFixture);
      await expect(
        chainBuy.connect(mallory).createExternalGroup(MERCHANT_ID, mallory.address, await params())
      ).to.be.revertedWithCustomError(chainBuy, "AccessControlUnauthorizedAccount");

      const id = await createExternal();
      const g = await chainBuy.getGroup(id);
      expect(g.kind).to.equal(Kind.EXTERNAL);
      expect(g.creator).to.equal(creator.address);
      expect(g.payee).to.equal(cardIssuer.address);
    });

    it("판매자 본인 지갑이 아니면 입점 상품 공구를 열 수 없다 (중복 공구 방지)", async () => {
      const { chainBuy, creator, mallory, params } = await loadFixture(deployFixture);
      for (const who of [creator, mallory]) {
        await expect(chainBuy.connect(who).createListedGroup(SELLER_ID, await params())).to.be.revertedWithCustomError(
          chainBuy,
          "NotSeller"
        );
      }
    });

    it("등록되지 않았거나 정지된 판매자·쇼핑몰로는 만들 수 없다", async () => {
      const { chainBuy, reviewer, admin, creator, seller, cardIssuer, params } = await loadFixture(deployFixture);
      await expect(
        chainBuy.connect(seller).createListedGroup(ethers.id("unknown"), await params())
      ).to.be.revertedWithCustomError(chainBuy, "InactiveParty");

      await chainBuy.connect(reviewer).setSeller(SELLER_ID, seller.address, false);
      await expect(
        chainBuy.connect(seller).createListedGroup(SELLER_ID, await params())
      ).to.be.revertedWithCustomError(chainBuy, "InactiveParty");

      await chainBuy.connect(admin).setMerchant(MERCHANT_ID, cardIssuer.address, false);
      await expect(
        chainBuy.connect(reviewer).createExternalGroup(MERCHANT_ID, creator.address, await params())
      ).to.be.revertedWithCustomError(chainBuy, "InactiveParty");
    });

    it("잘못된 조건은 거부한다", async () => {
      const { chainBuy, seller, params } = await loadFixture(deployFixture);
      const base = await params();
      const bad = [
        { ...base, maxPrice: 0n },
        { ...base, targetQty: 0 },
        { ...base, maxPerUser: 0 },
        { ...base, maxPerUser: base.targetQty + 1 },
        { ...base, deadline: BigInt(await time.latest()) },
      ];
      for (const p of bad) {
        await expect(chainBuy.connect(seller).createListedGroup(SELLER_ID, p)).to.be.revertedWithCustomError(
          chainBuy,
          "InvalidParams"
        );
      }
    });

    it("등록부가 바뀌어도 이미 생성된 공구의 결제 대상·수수료율은 그대로다 (INV-2, INV-5)", async () => {
      const { chainBuy, admin, reviewer, seller, mallory, createListed } = await loadFixture(deployFixture);
      const id = await createListed();
      await chainBuy.connect(reviewer).setSeller(SELLER_ID, mallory.address, true);
      await chainBuy.connect(admin).setFeeBps(1000);
      const g = await chainBuy.getGroup(id);
      expect(g.payee).to.equal(seller.address);
      expect(g.feeBps).to.equal(FEE_BPS);
    });
  });

  describe("참여·예치", () => {
    it("입점 상품은 최대 가격 × 수량, 외부 상품은 수수료 5%를 더해 예치한다 (DEP-01)", async () => {
      const { chainBuy, usdc, alice, createListed, createExternal } = await loadFixture(deployFixture);
      const listed = await createListed();
      const external = await createExternal();
      expect(await chainBuy.depositAmount(listed, 2)).to.equal(MAX_PRICE * 2n);
      expect(await chainBuy.depositAmount(external, 2)).to.equal(10_500n * 2n);

      await expect(chainBuy.connect(alice).deposit(listed, 2, ethers.id("a"))).to.changeTokenBalances(
        usdc,
        [alice, chainBuy],
        [-20_000n, 20_000n]
      );
      const p = await chainBuy.getParticipant(listed, alice.address);
      expect(p.qty).to.equal(2);
      expect(p.deposited).to.equal(20_000n);
    });

    it("1인 한도·목표 수량·마감을 넘는 참여는 거부한다 (DEP-03)", async () => {
      const { chainBuy, alice, bob, carol, createListed } = await loadFixture(deployFixture);
      const id = await createListed(); // target 3, 1인 최대 2
      await expect(chainBuy.connect(alice).deposit(id, 3, ethers.ZeroHash)).to.be.revertedWithCustomError(
        chainBuy,
        "QtyLimit"
      );
      await expect(chainBuy.connect(alice).deposit(id, 0, ethers.ZeroHash)).to.be.revertedWithCustomError(
        chainBuy,
        "QtyLimit"
      );
      await chainBuy.connect(alice).deposit(id, 2, ethers.ZeroHash);
      await expect(chainBuy.connect(alice).deposit(id, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(
        chainBuy,
        "QtyLimit"
      );
      await chainBuy.connect(bob).deposit(id, 1, ethers.ZeroHash);
      await expect(chainBuy.connect(carol).deposit(id, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(
        chainBuy,
        "QtyLimit"
      );

      const id2 = await createListed();
      await time.increase(3n * DAY);
      await expect(chainBuy.connect(alice).deposit(id2, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(
        chainBuy,
        "DeadlinePassed"
      );
    });

    it("마감 전에는 참여를 취소하고 전액 돌려받는다 (DEP-05)", async () => {
      const { chainBuy, usdc, alice, createListed } = await loadFixture(deployFixture);
      const id = await createListed();
      await chainBuy.connect(alice).deposit(id, 2, ethers.ZeroHash);
      await expect(chainBuy.connect(alice).withdraw(id)).to.changeTokenBalances(
        usdc,
        [alice, chainBuy],
        [20_000n, -20_000n]
      );
      expect((await chainBuy.getGroup(id)).totalQty).to.equal(0);
      await expect(chainBuy.connect(alice).withdraw(id)).to.be.revertedWithCustomError(chainBuy, "NotParticipant");
    });

    it("마감 후에는 참여 취소가 안 된다", async () => {
      const { chainBuy, alice, createListed } = await loadFixture(deployFixture);
      const id = await createListed();
      await chainBuy.connect(alice).deposit(id, 1, ethers.ZeroHash);
      await time.increase(3n * DAY);
      await expect(chainBuy.connect(alice).withdraw(id)).to.be.revertedWithCustomError(chainBuy, "DeadlinePassed");
    });
  });

  describe("마감·미달 환불", () => {
    it("목표 수량이 다 차면 마감 전이라도 확인 대기로 넘어간다 (RF-01)", async () => {
      const { chainBuy, createListed, fillAndFinalize } = await loadFixture(deployFixture);
      const id = await createListed();
      await fillAndFinalize(id);
      const g = await chainBuy.getGroup(id);
      expect(g.status).to.equal(Status.PENDING_CHECK);
      expect(g.pendingSince).to.be.greaterThan(0n);
    });

    it("마감 전이고 목표 미달이면 마감 판정을 할 수 없다", async () => {
      const { chainBuy, alice, createListed } = await loadFixture(deployFixture);
      const id = await createListed();
      await chainBuy.connect(alice).deposit(id, 1, ethers.ZeroHash);
      await expect(chainBuy.finalize(id)).to.be.revertedWithCustomError(chainBuy, "NotFinalizable");
    });

    it("마감 시각까지 미달이면 실패하고, 참여자는 전액 환불받는다 (RF-02)", async () => {
      const { chainBuy, usdc, alice, bob, createExternal } = await loadFixture(deployFixture);
      const id = await createExternal();
      await chainBuy.connect(alice).deposit(id, 1, ethers.ZeroHash);
      await chainBuy.connect(bob).deposit(id, 1, ethers.ZeroHash);
      await time.increase(3n * DAY);
      await expect(chainBuy.finalize(id)).to.emit(chainBuy, "Finalized").withArgs(id, Status.FAILED);

      expect(await chainBuy.refundableAmount(id, alice.address)).to.equal(10_500n);
      await expect(chainBuy.connect(alice).refund(id)).to.changeTokenBalances(
        usdc,
        [alice, chainBuy],
        [10_500n, -10_500n]
      );
      await expect(chainBuy.connect(alice).refund(id)).to.be.revertedWithCustomError(chainBuy, "AlreadyRefunded");
      await chainBuy.connect(bob).refund(id);
      expect(await usdc.balanceOf(await chainBuy.getAddress())).to.equal(0n);
    });

    it("모집 중에는 환불을 요청할 수 없다", async () => {
      const { chainBuy, alice, mallory, createListed } = await loadFixture(deployFixture);
      const id = await createListed();
      await chainBuy.connect(alice).deposit(id, 1, ethers.ZeroHash);
      await expect(chainBuy.connect(alice).refund(id)).to.be.revertedWithCustomError(chainBuy, "WrongStatus");
      await expect(chainBuy.connect(mallory).refund(id)).to.be.revertedWithCustomError(chainBuy, "NotParticipant");
    });
  });
});
