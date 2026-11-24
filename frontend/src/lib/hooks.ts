"use client";

import { useMemo } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { chainBuyAbi } from "./contracts.generated";
import { CHAINBUY_ADDRESS } from "./config";
import { OnchainGroup, toView, GroupView } from "./groups";

const cb = { address: CHAINBUY_ADDRESS, abi: chainBuyAbi } as const;

/** 모든 공구를 체인에서 읽는다. (백엔드 이벤트 수집이 생기면 api로 바꾼다) */
export function useGroups() {
  const count = useReadContract({ ...cb, functionName: "groupCount", query: { enabled: !!CHAINBUY_ADDRESS } });
  const n = Number(count.data ?? 0n);
  const ids = useMemo(() => Array.from({ length: n }, (_, i) => BigInt(i + 1)), [n]);

  const res = useReadContracts({
    contracts: ids.map((id) => ({ ...cb, functionName: "getGroup", args: [id] }) as const),
    query: { enabled: n > 0 },
  });

  const groups: GroupView[] = useMemo(
    () =>
      (res.data ?? [])
        .map((r, i) => (r.status === "success" ? toView(ids[i], r.result as unknown as OnchainGroup) : null))
        .filter((g): g is GroupView => g !== null),
    [res.data, ids]
  );

  return {
    groups,
    isLoading: count.isLoading || res.isLoading,
    error: count.error ?? res.error,
    refetch: async () => {
      await count.refetch();
      await res.refetch();
    },
  };
}

export function useGroup(id: bigint) {
  const res = useReadContract({ ...cb, functionName: "getGroup", args: [id], query: { enabled: !!CHAINBUY_ADDRESS } });
  const group = res.data ? toView(id, res.data as unknown as OnchainGroup) : undefined;
  return { group, isLoading: res.isLoading, error: res.error, refetch: res.refetch };
}

export function useMyParticipation(id: bigint) {
  const { address } = useAccount();
  const res = useReadContracts({
    contracts: [
      { ...cb, functionName: "getParticipant", args: [id, address!] },
      { ...cb, functionName: "refundableAmount", args: [id, address!] },
      { ...cb, functionName: "feeOf", args: [id, address!] },
    ],
    query: { enabled: !!address && !!CHAINBUY_ADDRESS },
  });
  const [p, refundable, fee] = res.data ?? [];
  return {
    participant: p?.status === "success" ? (p.result as { qty: number; deposited: bigint; refunded: boolean; receipt: number; feeSettled: boolean }) : undefined,
    refundable: refundable?.status === "success" ? (refundable.result as bigint) : 0n,
    fee: fee?.status === "success" ? (fee.result as bigint) : 0n,
    refetch: res.refetch,
  };
}
