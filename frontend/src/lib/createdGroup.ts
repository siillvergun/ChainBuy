import { parseEventLogs, type TransactionReceipt } from "viem";
import { chainBuyAbi } from "./contracts.generated";

/** 공구 생성 트랜잭션 영수증에서 새 공구 id를 꺼낸다 (groupCount를 다시 읽는 것보다 정확) */
export function createdGroupId(receipt: TransactionReceipt): bigint | null {
  const logs = parseEventLogs({ abi: chainBuyAbi, logs: receipt.logs, eventName: "GroupCreated" });
  return logs[0]?.args.id ?? null;
}

export const deadlineIn = (days: number) => BigInt(Math.floor(Date.now() / 1000) + days * 86_400);
