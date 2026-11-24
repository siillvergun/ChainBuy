"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { chainBuyAbi } from "@/lib/contracts.generated";
import { CHAINBUY_ADDRESS } from "@/lib/config";
import { GroupView, STATUS_LABEL, remaining, won } from "@/lib/groups";
import { ONGOING, useGroups } from "@/lib/hooks";
import { ProductThumb } from "./ProductThumb";

type P = { qty: number; deposited: bigint; refunded: boolean; receipt: number };
export type Participation = { g: GroupView; p: P; refundable: bigint };

/** 이 지갑이 참여한 공구 목록과 요약 (장바구니·마이페이지 공용) */
export function useParticipations(address: `0x${string}` | undefined) {
  const { groups, error, isLoading } = useGroups();
  const cb = { address: CHAINBUY_ADDRESS, abi: chainBuyAbi } as const;
  const reads = useReadContracts({
    contracts: groups.flatMap((g) => [
      { ...cb, functionName: "getParticipant", args: [g.id, address!] } as const,
      { ...cb, functionName: "refundableAmount", args: [g.id, address!] } as const,
    ]),
    query: { enabled: !!address && groups.length > 0 },
  });

  const rows: Participation[] = useMemo(() => {
    if (!reads.data) return [];
    return groups
      .map((g, i) => ({ g, p: reads.data[i * 2]?.result as P | undefined, refundable: (reads.data[i * 2 + 1]?.result as bigint | undefined) ?? 0n }))
      .filter((x): x is Participation => !!x.p && x.p.qty > 0)
      .reverse();
  }, [groups, reads.data]);

  const holding = rows.filter((x) => ["OPEN", "PENDING_CHECK", "APPROVED"].includes(x.g.statusName)).reduce((s, x) => s + x.p.deposited, 0n);
  const refundable = rows.reduce((s, x) => s + x.refundable, 0n);
  const toConfirm = rows.filter((x) => x.g.statusName === "SHIPPED" && x.p.receipt === 0).length;
  const ongoing = rows.filter((x) => ONGOING.has(x.g.statusName));
  const ended = rows.filter((x) => !ONGOING.has(x.g.statusName));

  return { rows, ongoing, ended, holding, refundable, toConfirm, error, isLoading: isLoading || reads.isLoading };
}

/** 참여한 상품 한 줄: 무엇을, 몇 개, 얼마 예치했고, 지금 어디까지 왔는지, 내가 할 일 */
export function ParticipationRow({ x }: { x: Participation }) {
  const { g, p, refundable } = x;
  const pct = Math.min(100, Math.round((g.totalQty / g.targetQty) * 100));
  const todo =
    refundable > 0n
      ? `${won(refundable)} 환불 받기`
      : g.statusName === "SHIPPED" && p.receipt === 0
        ? "수령 확인하기"
        : null;

  return (
    <li>
      <Link href={`/groups/${g.id}`} className="flex flex-wrap items-center gap-4 py-4 hover:bg-paper/60">
        <ProductThumb product={g.product} className="h-20 w-20 shrink-0 rounded-lg" />
        <div className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-xs font-bold text-muted">{g.isListed ? "판매자 특가" : "추천 공구 · 이용료 5%"}</span>
          <strong className="text-base font-medium">{g.product?.name ?? `공구 #${g.id}`}</strong>
          <span className="text-sm text-[#4A4A4A]">
            {g.product?.option && `${g.product.option} · `}
            {p.qty}개 · 예치 {won(p.deposited)}
            {p.refunded && " · 환불 받음"}
          </span>
          {g.statusName === "OPEN" && (
            <span className="flex items-center gap-2 text-xs text-muted">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
              </span>
              {g.totalQty}/{g.targetQty}개 · {remaining(g.deadline)}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-sm font-bold text-[#374151]">{STATUS_LABEL[g.statusName]}</span>
          {todo && <span className="text-sm font-bold text-accent">{todo} ›</span>}
        </div>
      </Link>
    </li>
  );
}

export function SummaryStats({ holding, toConfirm, refundable }: { holding: bigint; toConfirm: number; refundable: bigint }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Stat label="컨트랙트에 예치 중" value={won(holding)} />
      <Stat label="수령 확인 대기" value={`${toConfirm}건`} accent={toConfirm > 0} />
      <Stat label="지금 환불 받을 수 있는 금액" value={won(refundable)} accent={refundable > 0n} />
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
