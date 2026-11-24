"use client";

import { useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import { BaseError } from "viem";

/** 트랜잭션을 보내고 영수증까지 기다리는 공통 훅. 에러 메시지는 사용자용으로 짧게 바꾼다. */
export function useTx() {
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(label: string, params: Parameters<typeof writeContractAsync>[0]) {
    setError(null);
    setPending(label);
    try {
      const hash = await writeContractAsync(params);
      await client!.waitForTransactionReceipt({ hash });
      return hash;
    } catch (e) {
      const msg = e instanceof BaseError ? e.shortMessage : String(e);
      setError(msg.includes("User rejected") ? "지갑에서 요청을 거절했어요." : msg);
      throw e;
    } finally {
      setPending(null);
    }
  }

  return { send, pending, error, clearError: () => setError(null) };
}
