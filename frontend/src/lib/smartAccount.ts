"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import { Abi, BaseError, encodeFunctionData } from "viem";
import { useAuth } from "@/components/AuthProvider";
import { simpleAccountAbi } from "./contracts.generated";
import { api } from "./api";

/**
 * 계정 추상화 (ERC-4337)
 * 참여자는 MetaMask 주소가 주인인 "스마트 지갑"으로 공구에 참여한다.
 * MetaMask로는 서명만 하고, 가스비는 플랫폼(Paymaster)이 낸다 → 참여자에게 ETH가 필요 없다.
 */

/** 로그인한 MetaMask 주소의 스마트 지갑 주소. 체인의 참여 기록·토큰 잔액은 이 주소 기준 */
export function useSmartAccount() {
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ["smart-account", session?.token],
    queryFn: () => api<{ owner: string; account: `0x${string}`; deployed: boolean }>("/aa/account", { token: session!.token }),
    enabled: !!session?.token,
    refetchInterval: false,
    staleTime: Infinity, // 주소는 바뀌지 않는다
  });
  return q.data?.account;
}

/** 스마트 지갑이 대신 실행할 컨트랙트 호출 하나 */
export type ContractCall = {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
};

type Prepared = { userOp: Record<string, string>; userOpHash: `0x${string}` };

/** 여러 호출을 스마트 지갑 호출 하나로 묶는다 (하나면 execute, 여럿이면 executeBatch → 서명 한 번) */
function toAccountCall(calls: ContractCall[]): `0x${string}` {
  const encoded = calls.map((c) => encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: c.args }));
  if (calls.length === 1) {
    return encodeFunctionData({ abi: simpleAccountAbi, functionName: "execute", args: [calls[0].address, 0n, encoded[0]] });
  }
  return encodeFunctionData({
    abi: simpleAccountAbi,
    functionName: "executeBatch",
    args: [calls.map((c) => c.address), [], encoded],
  });
}

/**
 * 가스비 대납 트랜잭션 훅 (useTx와 같은 모양)
 * 1) 서버가 요청을 검사하고 가스비 대납 서명을 붙인 UserOperation을 만든다 (/aa/prepare)
 * 2) MetaMask로 그 요청의 해시에 서명한다 (거래 아님, ETH 필요 없음)
 * 3) 서버가 번들러로 EntryPoint에 제출하고 결과까지 기다린다 (/aa/send)
 */
export function useSponsoredTx() {
  const { session } = useAuth();
  const { signMessageAsync } = useSignMessage();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(label: string, calls: ContractCall[]) {
    setError(null);
    setPending(label);
    try {
      if (!session) throw new Error("지갑으로 로그인해 주세요.");
      const prepared = await api<Prepared>("/aa/prepare", { token: session.token, body: { callData: toAccountCall(calls) } });
      const signature = await signMessageAsync({ message: { raw: prepared.userOpHash } });
      return await api<{ txHash: `0x${string}`; success: boolean }>("/aa/send", {
        token: session.token,
        body: { userOp: { ...prepared.userOp, signature } },
      });
    } catch (e) {
      const msg = e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String(e);
      setError(msg.includes("User rejected") ? "지갑에서 서명을 거절했어요." : msg);
      throw e;
    } finally {
      setPending(null);
    }
  }

  return { send, pending, error, clearError: () => setError(null) };
}
