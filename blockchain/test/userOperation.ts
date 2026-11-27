import { ethers } from "hardhat";
import type { Signer } from "ethers";

/**
 * ERC-4337 v0.7 UserOperation을 만드는 테스트 도우미.
 * 실제 서비스에서는 프론트(viem)와 백엔드(Python)가 같은 순서로 만든다.
 */

export type PackedUserOperation = {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: bigint;
  gasFees: string;
  paymasterAndData: string;
  signature: string;
};

const VERIFICATION_GAS_LIMIT = 1_000_000n;
const CALL_GAS_LIMIT = 1_000_000n;
const PAYMASTER_VERIFICATION_GAS_LIMIT = 300_000n;
const PAYMASTER_POST_OP_GAS_LIMIT = 0n;
const PRE_VERIFICATION_GAS = 100_000n;

/** 상위 16바이트 · 하위 16바이트에 두 값을 담은 bytes32 */
function packTwoUint128(high: bigint, low: bigint): string {
  return ethers.toBeHex((high << 128n) | low, 32);
}

function paymasterPrefix(paymaster: string): string {
  return ethers.concat([
    paymaster,
    ethers.toBeHex(PAYMASTER_VERIFICATION_GAS_LIMIT, 16),
    ethers.toBeHex(PAYMASTER_POST_OP_GAS_LIMIT, 16),
  ]);
}

export async function buildUserOperation(params: {
  sender: string;
  nonce: bigint;
  initCode?: string;
  callData: string;
  paymaster: string;
}): Promise<PackedUserOperation> {
  const fee = await ethers.provider.getFeeData();
  const maxFee = (fee.maxFeePerGas ?? 2_000_000_000n) * 2n;
  const maxPriority = fee.maxPriorityFeePerGas ?? 1_000_000_000n;
  return {
    sender: params.sender,
    nonce: params.nonce,
    initCode: params.initCode ?? "0x",
    callData: params.callData,
    accountGasLimits: packTwoUint128(VERIFICATION_GAS_LIMIT, CALL_GAS_LIMIT),
    preVerificationGas: PRE_VERIFICATION_GAS,
    gasFees: packTwoUint128(maxPriority, maxFee),
    // 서명 칸은 비워 둔 채로 백엔드 서명 해시를 계산한다 (getHash는 가스 한도까지만 읽음)
    paymasterAndData: ethers.concat([paymasterPrefix(params.paymaster), ethers.AbiCoder.defaultAbiCoder().encode(["uint48", "uint48"], [0, 0])]),
    signature: "0x",
  };
}

/** 백엔드(가스 대납 서명자)가 서명: 유효 시간 + 서명을 paymasterAndData 뒤에 붙인다 */
export async function signAsSponsor(
  paymasterContract: { getHash: (op: PackedUserOperation, until: number, after: number) => Promise<string>; getAddress: () => Promise<string> },
  sponsor: Signer,
  op: PackedUserOperation,
  validUntil: number,
  validAfter = 0
): Promise<PackedUserOperation> {
  const hash = await paymasterContract.getHash(op, validUntil, validAfter);
  const signature = await sponsor.signMessage(ethers.getBytes(hash));
  const timestamps = ethers.AbiCoder.defaultAbiCoder().encode(["uint48", "uint48"], [validUntil, validAfter]);
  return { ...op, paymasterAndData: ethers.concat([paymasterPrefix(await paymasterContract.getAddress()), timestamps, signature]) };
}

/** 지갑 주인(MetaMask 역할)이 서명: EntryPoint가 계산한 UserOperation 해시에 개인 서명 */
export async function signAsOwner(
  entryPoint: { getUserOpHash: (op: PackedUserOperation) => Promise<string> },
  owner: Signer,
  op: PackedUserOperation
): Promise<PackedUserOperation> {
  const userOpHash = await entryPoint.getUserOpHash(op);
  return { ...op, signature: await owner.signMessage(ethers.getBytes(userOpHash)) };
}
