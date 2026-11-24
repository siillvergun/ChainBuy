import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, SELLER_ID, MAX_PRICE } from "./fixture";

describe("05. 공격 시나리오 · 관리자 · 긴급 정지", () => {
  describe("결제 대상·금액 조작 차단 (수용 기준)", () => {
    it("공구 생성 함수에는 결제 주소를 넣을 자리가 없다 — 판매자 등록부 값만 쓰인다 (INV-2)", async () => {
      const { chainBuy, seller, mallory, params } = await loadFixture(deployFixture);
      // 판매자가 아닌 사람은 판매자 상품으로 공구를 열 수조차 없다
      await expect(chainBuy.connect(mallory).createListedGroup(SELLER_ID, await params())).to.be.revertedWithCustomError(
        chainBuy,
        "NotSeller"
      );
      await chainBuy.connect(seller).createListedGroup(SELLER_ID, await params());
      const g = await chainBuy.getGroup(await chainBuy.groupCount());
      expect(g.payee).to.equal(seller.address);
    });

    it("판매자 등록부 변경은 담당자만 할 수 있다", async () => {
      const { chainBuy, mallory } = await loadFixture(deployFixture);
      await expect(
        chainBuy.connect(mallory).setSeller(SELLER_ID, mallory.address, true)
      ).to.be.revertedWithCustomError(chainBuy, "AccessControlUnauthorizedAccount");
    });

    it("승인 없이 결제할 수 없다", async () => {
      const { chainBuy, agent, createListed, fillAndFinalize } = await loadFixture(deployFixture);
      const id = await createListed();
      await fillAndFinalize(id);
      await chainBuy.connect(agent).submitCheck(id, 9_000n, ethers.ZeroHash);
      await expect(chainBuy.connect(agent).payListed(id)).to.be.revertedWithCustomError(chainBuy, "WrongStatus");
    });

    it("두 번 결제할 수 없다 (INV-4)", async () => {
      const { chainBuy, agent, createListed, createExternal, fillAndFinalize, checkAndApprove } =
        await loadFixture(deployFixture);
      const a = await createListed();
      await fillAndFinalize(a);
      await checkAndApprove(a);
      await chainBuy.connect(agent).payListed(a);
      await expect(chainBuy.connect(agent).payListed(a)).to.be.revertedWithCustomError(chainBuy, "WrongStatus");

      const b = await createExternal();
      await fillAndFinalize(b);
      await checkAndApprove(b);
      await chainBuy.connect(agent).fundCard(b, 1_000n);
      await expect(chainBuy.connect(agent).fundCard(b, 1_000n)).to.be.revertedWithCustomError(chainBuy, "WrongStatus");
    });

    it("AGENT 역할이 없으면 결제·충전·증거·배송 기록을 할 수 없다", async () => {
      const { chainBuy, mallory, reviewer, createListed, fillAndFinalize, checkAndApprove } =
        await loadFixture(deployFixture);
      const id = await createListed();
      await fillAndFinalize(id);
      await checkAndApprove(id);
      for (const call of [
        chainBuy.connect(mallory).payListed(id),
        chainBuy.connect(reviewer).payListed(id),
        chainBuy.connect(mallory).fundCard(id, 1n),
        chainBuy.connect(mallory).submitOrderProof(id, ethers.id("x")),
        chainBuy.connect(mallory).markShipped(id),
      ]) {
        await expect(call).to.be.revertedWithCustomError(chainBuy, "AccessControlUnauthorizedAccount");
      }
    });

    it("남의 환불을 대신 받아 갈 수 없다 — refund는 호출자 본인 몫만 처리한다", async () => {
      const { chainBuy, usdc, reviewer, mallory, alice, createListed, fillAndFinalize } =
        await loadFixture(deployFixture);
      const id = await createListed();
      await fillAndFinalize(id);
      await chainBuy.connect(reviewer).reject(id);
      await expect(chainBuy.connect(mallory).refund(id)).to.be.revertedWithCustomError(chainBuy, "NotParticipant");
      await expect(chainBuy.connect(alice).refund(id)).to.changeTokenBalance(usdc, alice, MAX_PRICE);
    });

    it("관리자도 예치금을 꺼낼 방법이 없다 — 컨트랙트 ABI에 출금 함수가 없다 (INV-1)", async () => {
      const { chainBuy } = await loadFixture(deployFixture);
      const names = chainBuy.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => (f as any).name as string);
      for (const forbidden of ["withdrawAll", "sweep", "rescue", "emergencyWithdraw", "transferOut"]) {
        expect(names).to.not.include(forbidden);
      }
    });
  });

  describe("관리자 설정", () => {
    it("수수료율은 10%를 넘을 수 없다 (INV-5)", async () => {
      const { chainBuy, admin } = await loadFixture(deployFixture);
      await expect(chainBuy.connect(admin).setFeeBps(1001)).to.be.revertedWithCustomError(chainBuy, "InvalidParams");
      await expect(chainBuy.connect(admin).setFeeBps(1000)).to.emit(chainBuy, "FeeBpsSet").withArgs(1000);
    });

    it("관리자 함수는 관리자만 호출할 수 있다", async () => {
      const { chainBuy, mallory } = await loadFixture(deployFixture);
      const err = "AccessControlUnauthorizedAccount";
      await expect(chainBuy.connect(mallory).setFeeBps(100)).to.be.revertedWithCustomError(chainBuy, err);
      await expect(chainBuy.connect(mallory).setFeeRecipient(mallory.address)).to.be.revertedWithCustomError(
        chainBuy,
        err
      );
      await expect(
        chainBuy.connect(mallory).setMerchant(ethers.id("m"), mallory.address, true)
      ).to.be.revertedWithCustomError(chainBuy, err);
      await expect(chainBuy.connect(mallory).pause()).to.be.revertedWithCustomError(chainBuy, err);
    });

    it("0 주소는 등록할 수 없다", async () => {
      const { chainBuy, admin, reviewer } = await loadFixture(deployFixture);
      await expect(
        chainBuy.connect(reviewer).setSeller(SELLER_ID, ethers.ZeroAddress, true)
      ).to.be.revertedWithCustomError(chainBuy, "InvalidParams");
      await expect(
        chainBuy.connect(admin).setMerchant(ethers.id("m"), ethers.ZeroAddress, true)
      ).to.be.revertedWithCustomError(chainBuy, "InvalidParams");
      await expect(chainBuy.connect(admin).setFeeRecipient(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        chainBuy,
        "InvalidParams"
      );
    });

    it("생성자에 잘못된 값을 넣으면 배포가 실패한다", async () => {
      const { usdc, admin } = await loadFixture(deployFixture);
      const F = await ethers.getContractFactory("ChainBuy");
      const token = await usdc.getAddress();
      await expect(F.deploy(ethers.ZeroAddress, admin.address, admin.address, 500)).to.be.revertedWithCustomError(
        F,
        "InvalidParams"
      );
      await expect(F.deploy(token, admin.address, admin.address, 1001)).to.be.revertedWithCustomError(
        F,
        "InvalidParams"
      );
    });

    it("수수료 수령 주소를 바꾸면 이후 지급분부터 새 주소로 간다", async () => {
      const f = await loadFixture(deployFixture);
      const id = await f.createListed();
      await f.fillAndFinalize(id);
      await f.checkAndApprove(id);
      await f.chainBuy.connect(f.agent).payListed(id);
      await f.chainBuy.connect(f.agent).submitOrderProof(id, ethers.id("o"));
      await f.chainBuy.connect(f.agent).markShipped(id);
      await f.chainBuy.connect(f.admin).setFeeRecipient(f.admin.address);
      await f.chainBuy.connect(f.alice).confirmReceipt(id);
      await expect(f.chainBuy.releaseFee(id, f.alice.address)).to.changeTokenBalance(f.usdc, f.admin, 450n);
    });
  });

  describe("긴급 정지 (ADM-07, INV-8)", () => {
    it("정지 중에는 공구 생성·예치가 막힌다", async () => {
      const { chainBuy, admin, alice, creator, seller, reviewer, params, createListed } = await loadFixture(deployFixture);
      const id = await createListed();
      await chainBuy.connect(admin).pause();
      await expect(
        chainBuy.connect(seller).createListedGroup(SELLER_ID, await params())
      ).to.be.revertedWithCustomError(chainBuy, "EnforcedPause");
      await expect(
        chainBuy.connect(reviewer).createExternalGroup(ethers.id("merchant:big-mall"), creator.address, await params())
      ).to.be.revertedWithCustomError(chainBuy, "EnforcedPause");
      await expect(chainBuy.connect(alice).deposit(id, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(
        chainBuy,
        "EnforcedPause"
      );
      await chainBuy.connect(admin).unpause();
      await chainBuy.connect(alice).deposit(id, 1, ethers.ZeroHash);
    });

    it("정지 중에도 참여 취소·환불·수수료 지급은 된다", async () => {
      const f = await loadFixture(deployFixture);
      // 참여 취소
      const open = await f.createListed();
      await f.chainBuy.connect(f.alice).deposit(open, 1, ethers.ZeroHash);

      // 수수료 지급까지 갈 공구
      const id = await f.createListed();
      await f.fillAndFinalize(id);
      await f.checkAndApprove(id);
      await f.chainBuy.connect(f.agent).payListed(id);
      await f.chainBuy.connect(f.agent).submitOrderProof(id, ethers.id("o"));
      await f.chainBuy.connect(f.agent).markShipped(id);
      await f.chainBuy.connect(f.alice).confirmReceipt(id);

      await f.chainBuy.connect(f.admin).pause();
      await expect(f.chainBuy.connect(f.alice).withdraw(open)).to.changeTokenBalance(f.usdc, f.alice, MAX_PRICE);
      await expect(f.chainBuy.connect(f.alice).refund(id)).to.changeTokenBalance(f.usdc, f.alice, 1_000n);
      await expect(f.chainBuy.releaseFee(id, f.alice.address)).to.changeTokenBalance(f.usdc, f.feeRecipient, 450n);
    });
  });
});
