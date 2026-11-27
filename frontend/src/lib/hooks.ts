"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { chainBuyAbi } from "./contracts.generated";
import { CHAINBUY_ADDRESS } from "./config";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { OnchainGroup, toView, GroupView, Product, fallbackProducts } from "./groups";
import { api, ApiProduct, SponsorTag, UserProfile } from "./api";
import { useSmartAccount } from "./smartAccount";

const cb = { address: CHAINBUY_ADDRESS, abi: chainBuyAbi } as const;

/** 상품 정보(이름·카테고리 등)를 백엔드에서 가져와 productHash로 찾는 표를 만든다 */
export function useProducts() {
  const q = useQuery({
    queryKey: ["products"],
    queryFn: () => api<ApiProduct[]>("/products"),
    refetchInterval: 30_000,
    retry: 1,
  });
  const map = useMemo(() => {
    if (!q.data) return fallbackProducts;
    const m = new Map<string, Product>(fallbackProducts);
    for (const p of q.data) m.set(p.productHash, p);
    return m;
  }, [q.data]);
  return { map, list: q.data, isLoading: q.isLoading, error: q.error, refetch: q.refetch };
}

/** 모든 공구를 체인에서 읽는다. (백엔드 이벤트 수집이 생기면 api로 바꾼다) */
export function useGroups() {
  const products = useProducts();
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
        .map((r, i) => (r.status === "success" ? toView(ids[i], r.result as unknown as OnchainGroup, products.map) : null))
        .filter((g): g is GroupView => g !== null),
    [res.data, ids, products.map]
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
  const products = useProducts();
  const res = useReadContract({ ...cb, functionName: "getGroup", args: [id], query: { enabled: !!CHAINBUY_ADDRESS } });
  const group = res.data ? toView(id, res.data as unknown as OnchainGroup, products.map) : undefined;
  return { group, isLoading: res.isLoading, error: res.error, refetch: res.refetch };
}

export function useMyParticipation(id: bigint) {
  // 참여는 스마트 지갑(계정 추상화)으로 하므로 그 주소로 읽는다
  const address = useSmartAccount();
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

/** 공개된 협찬 태그 (공구 id → 인플루언서 목록) */
export function useSponsorTags() {
  const q = useQuery({ queryKey: ["tags"], queryFn: () => api<SponsorTag[]>("/tags"), refetchInterval: 30_000, retry: 1 });
  return useMemo(() => {
    const m = new Map<number, SponsorTag[]>();
    for (const t of q.data ?? []) m.set(t.groupId, [...(m.get(t.groupId) ?? []), t]);
    return m;
  }, [q.data]);
}

/** 로그인한 사용자의 프로필·배송지 */
export function useMe(token: string | undefined) {
  return useQuery({
    queryKey: ["me", token],
    queryFn: () => api<UserProfile>("/users/me", { token }),
    enabled: !!token,
    refetchInterval: false,
  });
}

/** 이 지갑이 참여한 공구 (참여 수량 > 0). 헤더 배지와 마이페이지가 같이 쓴다 */
export function useMyGroups(address: `0x${string}` | undefined) {
  const { groups } = useGroups();
  const reads = useReadContracts({
    contracts: groups.map((g) => ({ ...cb, functionName: "getParticipant", args: [g.id, address!] }) as const),
    query: { enabled: !!address && groups.length > 0 },
  });
  return useMemo(() => {
    if (!reads.data) return [];
    return groups.filter((_, i) => Number((reads.data[i]?.result as { qty?: number } | undefined)?.qty ?? 0) > 0);
  }, [groups, reads.data]);
}

/** 아직 끝나지 않은 공구 (모집~배송 완료) */
export const ONGOING = new Set(["OPEN", "PENDING_CHECK", "APPROVED", "PAID", "SHIPPED"]);

/** 찜: 내가 찜한 공구 id 목록, 공구별 찜 수, 찜하기/해제 (화면에는 바로 반영) */
export function useLikes(token: string | undefined) {
  const qc = useQueryClient();
  const mine = useQuery({
    queryKey: ["likes", token],
    queryFn: () => api<number[]>("/likes", { token }),
    enabled: !!token,
    refetchInterval: false,
  });
  const counts = useQuery({ queryKey: ["like-counts"], queryFn: () => api<Record<string, number>>("/likes/counts"), refetchInterval: 30_000, retry: 1 });
  const set = useMemo(() => new Set(mine.data ?? []), [mine.data]);

  const toggle = async (groupId: number) => {
    if (!token) return;
    const liked = set.has(groupId);
    // 서버 응답을 기다리지 않고 먼저 화면을 바꾼다
    qc.setQueryData<number[]>(["likes", token], (old = []) => (liked ? old.filter((x) => x !== groupId) : [groupId, ...old]));
    qc.setQueryData<Record<string, number>>(["like-counts"], (old = {}) => ({ ...old, [groupId]: Math.max(0, (old[groupId] ?? 0) + (liked ? -1 : 1)) }));
    try {
      await api(`/likes/${groupId}`, { token, method: liked ? "DELETE" : "POST", body: liked ? undefined : {} });
    } finally {
      void qc.invalidateQueries({ queryKey: ["likes", token] });
      void qc.invalidateQueries({ queryKey: ["like-counts"] });
    }
  };

  return { liked: set, ids: mine.data ?? [], counts: counts.data ?? {}, toggle };
}
