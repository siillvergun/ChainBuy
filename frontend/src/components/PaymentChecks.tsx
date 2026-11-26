"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, Activity } from "@/lib/api";
import { chainBuyAbi } from "@/lib/contracts.generated";
import { CHAINBUY_ADDRESS } from "@/lib/config";
import { GroupView, won } from "@/lib/groups";
import { useGroups } from "@/lib/hooks";
import { useTx } from "@/lib/useTx";
import { Notice } from "./Field";

/**
 * 담당자 결제 승인 (ADM-03, AI-05)
 * AI 에이전트가 상품 확인 결과를 제출한 공구를, 담당자가 결과를 보고 승인·거절한다.
 * 승인해야 에이전트가 결제할 수 있다 (AI 제출 + 담당자 승인 둘 다 필요).
 */
export function PaymentChecks() {
  const { groups, refetch } = useGroups();
  const waiting = groups.filter((g) => g.statusName === "PENDING_CHECK");

  if (!waiting.length) return <p className="text-muted">확인 대기 중인 공구가 없어요.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {waiting.map((g) => (
        <CheckRow key={String(g.id)} g={g} onDone={() => void refetch()} />
      ))}
    </ul>
  );
}

function CheckRow({ g, onDone }: { g: GroupView; onDone: () => void }) {
  const tx = useTx();
  const activity = useQuery({ queryKey: ["activity", Number(g.id)], queryFn: () => api<Activity[]>(`/groups/${g.id}/activity`) });
  const check = activity.data?.find((a) => a.action === "check");
  const d = (check?.detail ?? {}) as { price?: number; inStock?: boolean; options?: string[]; method?: string; wantedOption?: string };

  const act = (fn: "approve" | "reject") => async () => {
    try {
      await tx.send(fn === "approve" ? "승인 중" : "거절 중", { address: CHAINBUY_ADDRESS!, abi: chainBuyAbi, functionName: fn, args: [g.id] });
      onDone();
    } catch {
      /* tx.error 표시 */
    }
  };

  return (
    <li className="rounded-xl border border-line p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-[240px] flex-1">
          <Link href={`/groups/${g.id}`} className="text-base font-bold hover:underline">
            #{String(g.id)} {g.product?.name ?? "공구"}
          </Link>
          <p className="text-sm text-muted">
            {g.isListed ? "판매자 특가 (경로 A)" : "외부 상품 (경로 B · 일회용 카드)"} · {g.totalQty}개 · 최대 {won(g.maxPrice)}
          </p>
        </div>
        {!g.checkSubmitted && <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-sm font-bold">AI 확인 중</span>}
      </div>

      {g.checkSubmitted && (
        <div className="mt-3 grid gap-2 rounded-lg bg-paper p-4 text-sm sm:grid-cols-2">
          <span>
            AI 확인 가격 <strong>{won(g.checkedPrice)}</strong> / 최대 {won(g.maxPrice)}
          </span>
          <span>재고 {d.inStock === false ? "품절" : "있음"}</span>
          {d.options?.length ? <span>옵션 {d.options.join(", ")}{d.wantedOption && ` (요청: ${d.wantedOption})`}</span> : null}
          <span className="text-muted">확인 방식: {d.method === "llm" ? "LLM" : d.method === "rule" ? "규칙 기반" : "등록 상품 정보"}</span>
          <span className="text-muted sm:col-span-2">
            결과 해시 <code className="break-all">{g.checkHash}</code>
          </span>
        </div>
      )}

      {g.checkSubmitted && (
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn-primary" disabled={!!tx.pending} onClick={act("approve")}>
            {tx.pending ?? "승인 (결제 진행)"}
          </button>
          <button type="button" className="btn-line" disabled={!!tx.pending} onClick={act("reject")}>
            거절 (전액 환불)
          </button>
        </div>
      )}
      {tx.error && (
        <div className="mt-3">
          <Notice tone="error">{tx.error}</Notice>
        </div>
      )}
    </li>
  );
}
