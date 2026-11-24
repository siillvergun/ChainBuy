"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { useGroups } from "@/lib/hooks";
import { chainBuyAbi } from "@/lib/contracts.generated";
import { CHAINBUY_ADDRESS } from "@/lib/config";
import { STATUS_LABEL, won } from "@/lib/groups";
import { ProductThumb } from "@/components/ProductThumb";
import { ChainNotice, Empty } from "@/components/States";

type P = { qty: number; deposited: bigint; refunded: boolean; receipt: number };

export default function MyPage() {
  const { address, isConnected } = useAccount();
  const { groups, error } = useGroups();
  const cb = { address: CHAINBUY_ADDRESS, abi: chainBuyAbi } as const;

  const reads = useReadContracts({
    contracts: groups.flatMap((g) => [
      { ...cb, functionName: "getParticipant", args: [g.id, address!] } as const,
      { ...cb, functionName: "refundableAmount", args: [g.id, address!] } as const,
    ]),
    query: { enabled: !!address && groups.length > 0 },
  });

  const mine = useMemo(() => {
    if (!reads.data) return [];
    return groups
      .map((g, i) => ({ g, p: reads.data[i * 2]?.result as P | undefined, refundable: (reads.data[i * 2 + 1]?.result as bigint | undefined) ?? 0n }))
      .filter((x) => x.p && x.p.qty > 0)
      .reverse();
  }, [groups, reads.data]);

  const holding = mine.filter((x) => ["OPEN", "PENDING_CHECK", "APPROVED"].includes(x.g.statusName)).reduce((s, x) => s + x.p!.deposited, 0n);
  const refundable = mine.reduce((s, x) => s + x.refundable, 0n);
  const toConfirm = mine.filter((x) => x.g.statusName === "SHIPPED" && x.p!.receipt === 0).length;

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-6 px-4 py-10 md:px-6">
      <h1 className="text-[28px] font-extrabold tracking-tight">내 참여</h1>
      <ChainNotice error={error} />

      {!isConnected ? (
        <Empty>지갑을 연결하면 참여한 공구가 보여요.</Empty>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="컨트랙트에 예치 중" value={won(holding)} />
            <Stat label="수령 확인 대기" value={`${toConfirm}건`} accent={toConfirm > 0} />
            <Stat label="지금 환불 받을 수 있는 금액" value={won(refundable)} accent={refundable > 0n} />
          </div>

          {mine.length === 0 ? (
            <Empty>
              아직 참여한 공구가 없어요.{" "}
              <Link href="/groups" className="font-bold text-accent">
                공구 둘러보기
              </Link>
            </Empty>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-white px-5">
              {mine.map(({ g, p, refundable }) => (
                <li key={String(g.id)}>
                  <Link href={`/groups/${g.id}`} className="flex flex-wrap items-center gap-4 py-4">
                    <ProductThumb product={g.product} className="h-14 w-14 shrink-0 rounded-lg" />
                    <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
                      <strong className="text-[15px] font-medium">{g.product?.name ?? `공구 #${g.id}`}</strong>
                      <span className="text-sm text-muted">
                        {p!.qty}개 · {won(p!.deposited)} 예치{p!.refunded && " · 환불 받음"}
                      </span>
                    </div>
                    {refundable > 0n && <span className="text-sm font-bold text-accent">{won(refundable)} 환불 가능</span>}
                    {g.statusName === "SHIPPED" && p!.receipt === 0 && <span className="text-sm font-bold text-accent">수령 확인 필요</span>}
                    <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-sm font-bold text-[#374151]">{STATUS_LABEL[g.statusName]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-1.5 rounded-xl border p-5 ${accent ? "border-accent" : "border-line"}`}>
      <span className="text-sm text-muted">{label}</span>
      <strong className="text-2xl font-extrabold">{value}</strong>
    </div>
  );
}
