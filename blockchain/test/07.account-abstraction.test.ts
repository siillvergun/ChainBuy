import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture } from "./fixture";
import { buildUserOperation, signAsOwner, signAsSponsor, PackedUserOperation } from "./userOperation";

/** 계정 추상화 구성: EntryPoint · 스마트 지갑 팩토리 · 가스비 대납 Paymaster + ETH가 0인 참여자 */
async function accountAbstractionFixture() {
  const f = await loadFixture(deployFixture);
  const signers = await ethers.getSigners();
  const sponsor = signers[11]; // 백엔드 가스 대납 서명자
  const bundler = signers[12]; // 백엔드가 번들러로 EntryPoint에 제출

  const entryPoint = await ethers.deployContract("EntryPoint");
  const factory = await ethers.deployContract("SimpleAccountFactory", [await entryPoint.getAddress()]);
  const paymaster = await ethers.deployContract("ChainBuyPaymaster", [
    await entryPoint.getAddress(),
    sponsor.address,
    await f.chainBuy.getAddress(),
    await f.token.getAddress(),
  ]);
  await paymaster.deposit({ value: ethers.parseEther("10") }); // 플랫폼이 가스비용 ETH를 맡겨 둔다

  // ETH가 하나도 없는 새 참여자 (MetaMask 지갑 역할)
  const owner = ethers.Wallet.createRandom().connect(ethers.provider);
  const account = await factory.getFunction("getAddress")(owner.address, 0);
  const initCode = ethers.concat([
    factory.target as string, // 팩토리의 getAddress는 스마트 지갑 주소 계산 함수라 배포 주소는 target으로
    factory.interface.encodeFunctionData("createAccount", [owner.address, 0]),
  ]);

  const accountInterface = (await ethers.getContractFactory("SimpleAccount")).interface;
  const executeBatch = (calls: { target: string; data: string }[]) =>
    accountInterface.encodeFunctionData("executeBatch", [calls.map((c) => c.target), [], calls.map((c) => c.data)]);
  const execute = (target: string, data: string) => accountInterface.encodeFunctionData("execute", [target, 0, data]);

  const validUntil = async () => (await time.latest()) + 600;

  /** 대납 서명 + 주인 서명 → 번들러 제출까지 */
  async function sendUserOperation(callData: string, options: { withInitCode?: boolean; signer?: typeof sponsor } = {}) {
    const nonce = await entryPoint.getNonce(account, 0);
    let op: PackedUserOperation = await buildUserOperation({
      sender: account,
      nonce,
      initCode: options.withInitCode ? initCode : "0x",
      callData,
      paymaster: await paymaster.getAddress(),
    });
    op = await signAsSponsor(paymaster, options.signer ?? sponsor, op, await validUntil());
    op = await signAsOwner(entryPoint, owner, op);
    return entryPoint.connect(bundler).handleOps([op], bundler.address);
  }

  return { ...f, entryPoint, factory, paymaster, sponsor, bundler, owner, account, executeBatch, execute, sendUserOperation };
}

describe("07. 계정 추상화 — ETH 없이 서명만으로 참여 (ERC-4337)", () => {
  it("ETH가 0인 참여자가 토큰 받기 → 승인 + 예치를 서명만으로 하고, 가스비는 Paymaster가 낸다", async () => {
    const { chainBuy, token, paymaster, owner, account, executeBatch, execute, sendUserOperation, createListed } =
      await accountAbstractionFixture();
    const id = await createListed();
    const chainBuyAddress = await chainBuy.getAddress();
    const tokenAddress = await token.getAddress();
    const depositBefore = await paymaster.getDeposit();

    // 1) 첫 요청에서 스마트 지갑이 만들어지고 테스트 토큰을 받는다
    await sendUserOperation(execute(tokenAddress, token.interface.encodeFunctionData("mint", [account, 50_000n])), {
      withInitCode: true,
    });
    expect(await token.balanceOf(account)).to.equal(50_000n);

    // 2) 승인 + 예치를 한 번의 서명으로 묶는다
    await sendUserOperation(
      executeBatch([
        { target: tokenAddress, data: token.interface.encodeFunctionData("approve", [chainBuyAddress, 20_000n]) },
        { target: chainBuyAddress, data: chainBuy.interface.encodeFunctionData("deposit", [id, 2, ethers.id("addr")]) },
      ])
    );

    const participant = await chainBuy.getParticipant(id, account);
    expect(participant.qty).to.equal(2n);
    expect(await ethers.provider.getBalance(owner.address)).to.equal(0n); // 참여자는 ETH를 쓰지 않았다
    expect(await paymaster.getDeposit()).to.be.lessThan(depositBefore); // 가스비는 플랫폼 예치금에서 나갔다
  });

  it("참여 취소(withdraw)도 대납된다", async () => {
    const { chainBuy, token, account, executeBatch, execute, sendUserOperation, createListed } = await accountAbstractionFixture();
    const id = await createListed();
    await sendUserOperation(execute(await token.getAddress(), token.interface.encodeFunctionData("mint", [account, 10_000n])), {
      withInitCode: true,
    });
    await sendUserOperation(
      executeBatch([
        { target: await token.getAddress(), data: token.interface.encodeFunctionData("approve", [await chainBuy.getAddress(), 10_000n]) },
        { target: await chainBuy.getAddress(), data: chainBuy.interface.encodeFunctionData("deposit", [id, 1, ethers.id("addr")]) },
      ])
    );
    await sendUserOperation(execute(await chainBuy.getAddress(), chainBuy.interface.encodeFunctionData("withdraw", [id])));
    expect(await token.balanceOf(account)).to.equal(10_000n);
  });

  describe("남용 차단", () => {
    it("ChainBuy와 무관한 호출(다른 사람에게 토큰 보내기)은 대납하지 않는다", async () => {
      const { token, entryPoint, paymaster, mallory, account, execute, sendUserOperation } = await accountAbstractionFixture();
      const steal = execute(await token.getAddress(), token.interface.encodeFunctionData("transfer", [mallory.address, 1n]));
      await expect(sendUserOperation(steal, { withInitCode: true }))
        .to.be.revertedWithCustomError(entryPoint, "FailedOpWithRevert")
        .withArgs(0, "AA33 reverted", paymaster.interface.encodeErrorResult("CallNotSponsored", [await token.getAddress(), token.interface.getFunction("transfer")!.selector]));
    });

    it("ChainBuy가 아닌 주소에 사용 승인(approve)하는 것은 대납하지 않는다", async () => {
      const { token, entryPoint, mallory, execute, sendUserOperation } = await accountAbstractionFixture();
      const approveOther = execute(await token.getAddress(), token.interface.encodeFunctionData("approve", [mallory.address, 1n]));
      await expect(sendUserOperation(approveOther, { withInitCode: true })).to.be.revertedWithCustomError(entryPoint, "FailedOpWithRevert");
    });

    it("남의 지갑으로 토큰을 발행하는 것은 대납하지 않는다", async () => {
      const { token, entryPoint, mallory, execute, sendUserOperation } = await accountAbstractionFixture();
      const mintOther = execute(await token.getAddress(), token.interface.encodeFunctionData("mint", [mallory.address, 1n]));
      await expect(sendUserOperation(mintOther, { withInitCode: true })).to.be.revertedWithCustomError(entryPoint, "FailedOpWithRevert");
    });

    it("ETH를 함께 보내는 호출은 대납하지 않는다", async () => {
      const { chainBuy, entryPoint, sendUserOperation } = await accountAbstractionFixture();
      const accountInterface = (await ethers.getContractFactory("SimpleAccount")).interface;
      const withValue = accountInterface.encodeFunctionData("execute", [
        await chainBuy.getAddress(),
        1n,
        chainBuy.interface.encodeFunctionData("refund", [1]),
      ]);
      await expect(sendUserOperation(withValue, { withInitCode: true })).to.be.revertedWithCustomError(entryPoint, "FailedOpWithRevert");
    });

    it("백엔드가 서명하지 않은 요청은 거절된다", async () => {
      const { token, entryPoint, mallory, account, execute, sendUserOperation } = await accountAbstractionFixture();
      const mint = execute(await token.getAddress(), token.interface.encodeFunctionData("mint", [account, 1n]));
      await expect(sendUserOperation(mint, { withInitCode: true, signer: mallory }))
        .to.be.revertedWithCustomError(entryPoint, "FailedOp")
        .withArgs(0, "AA34 signature error");
    });
  });
});
