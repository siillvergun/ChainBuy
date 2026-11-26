"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, Proposal, Seller, STATUS_KO } from "@/lib/api";
import { chainBuyAbi } from "@/lib/contracts.generated";
import { CHAINBUY_ADDRESS } from "@/lib/config";
import { createdGroupId, deadlineIn } from "@/lib/createdGroup";
import { toToken } from "@/lib/groups";
import { useTx } from "@/lib/useTx";
import { useAuth } from "@/components/AuthProvider";
import { LoginGate } from "@/components/LoginGate";
import { Notice } from "@/components/Field";
import { PaymentChecks } from "@/components/PaymentChecks";

/**
 * 담당자 화면 (ADM-01, ADM-02)
 * 체인에 기록하는 일(판매자 지갑 등록, 외부 공구 생성)은 담당자 지갑으로 직접 보내고,
 * 서버는 체인을 읽어 확인한 뒤 승인 상태로 바꾼다.
 */
export default function AdminPage() {
  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-8 px-4 py-10 md:px-6">
      <h1 className="text-[28px] font-extrabold tracking-tight">담당자</h1>
      <LoginGate what="담당자 화면">
        <AdminHome />
      </LoginGate>
    </div>
  );
}

function AdminHome() {
  const { session } = useAuth();
  const [tab, setTab] = useState<"checks" | "sellers" | "proposals">("checks");
  if (!session?.isReviewer) return <Notice tone="error">담당자(REVIEWER 역할) 지갑으로 로그인해야 볼 수 있어요.</Notice>;

  return (
    <>
      <div role="tablist" className="flex gap-6 border-b border-line">
        {(
          [
            ["checks", "결제 승인"],
            ["sellers", "판매자 입점 신청"],
            ["proposals", "외부 상품 공구 제안"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={tab === v}
            onClick={() => setTab(v)}
            className={`-mb-px border-b-2 py-3 text-base ${tab === v ? "border-ink font-bold" : "border-transparent text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "checks" ? <PaymentChecks /> : tab === "sellers" ? <Sellers token={session.token} /> : <Proposals token={session.token} />}
    </>
  );
}

function StatusChip({ s }: { s: keyof typeof STATUS_KO }) {
  const cls = s === "approved" ? "bg-safe-tint text-safe" : s === "rejected" ? "bg-accent-tint text-accent-dark" : "bg-[#F3F4F6] text-[#374151]";
  return <span className={`rounded-full px-3 py-1 text-sm font-bold ${cls}`}>{STATUS_KO[s]}</span>;
}

function Sellers({ token }: { token: string }) {
  const q = useQuery({ queryKey: ["admin-sellers", token], queryFn: () => api<Seller[]>("/admin/sellers", { token }) });
  if (q.error) return <Notice tone="error">{(q.error as Error).message}</Notice>;
  if (!q.data?.length) return <p className="text-muted">신청이 없어요.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {q.data.map((s) => (
        <SellerRow key={s.id} s={s} token={token} onDone={() => q.refetch()} />
      ))}
    </ul>
  );
}

function SellerRow({ s, token, onDone }: { s: Seller; token: string; onDone: () => void }) {
  const tx = useTx();
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    setError(null);
    try {
      // 1) 담당자 지갑으로 컨트랙트 판매자 등록부에 지갑 기록
      await tx.send("판매자 지갑 등록 중", {
        address: CHAINBUY_ADDRESS!,
        abi: chainBuyAbi,
        functionName: "setSeller",
        args: [s.sellerIdHash, s.address, true],
      });
      // 2) 서버가 체인을 확인하고 승인
      await api(`/admin/sellers/${encodeURIComponent(s.id)}/approve`, { token, body: {} });
      onDone();
    } catch (e) {
      if (!tx.error) setError((e as Error).message);
    }
  };

  const reject = async () => {
    const reason = window.prompt("반려 사유");
    if (!reason) return;
    try {
      await api(`/admin/sellers/${encodeURIComponent(s.id)}/reject`, { token, body: { reason } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <li className="rounded-xl border border-line p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-[240px] flex-1">
          <strong className="text-base">{s.name}</strong>
          <p className="text-sm text-muted">
            사업자 {s.bizNo} · {s.contact}
          </p>
          <p className="break-all font-mono text-xs text-muted">{s.address}</p>
        </div>
        <StatusChip s={s.status} />
        {s.status === "pending" && (
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={!!tx.pending} onClick={approve}>
              {tx.pending ?? "승인 (체인 등록)"}
            </button>
            <button type="button" className="btn-line" onClick={reject}>
              반려
            </button>
          </div>
        )}
      </div>
      {(tx.error || error) && (
        <div className="mt-3">
          <Notice tone="error">{tx.error ?? error}</Notice>
        </div>
      )}
    </li>
  );
}

function Proposals({ token }: { token: string }) {
  const q = useQuery({ queryKey: ["admin-proposals", token], queryFn: () => api<Proposal[]>("/admin/proposals", { token }) });
  if (q.error) return <Notice tone="error">{(q.error as Error).message}</Notice>;
  if (!q.data?.length) return <p className="text-muted">제안이 없어요.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {q.data.map((p) => (
        <ProposalRow key={p.id} p={p} token={token} onDone={() => q.refetch()} />
      ))}
    </ul>
  );
}

function ProposalRow({ p, token, onDone }: { p: Proposal; token: string; onDone: () => void }) {
  const tx = useTx();
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    setError(null);
    try {
      // 1) 담당자 지갑으로 외부 상품 공구 생성 (등록자 = 제안자)
      const receipt = await tx.send("공구 생성 중", {
        address: CHAINBUY_ADDRESS!,
        abi: chainBuyAbi,
        functionName: "createExternalGroup",
        args: [
          p.merchantIdHash,
          p.proposer,
          { productHash: p.productHash, maxPrice: toToken(p.maxPrice), targetQty: p.targetQty, maxPerUser: p.maxPerUser, deadline: deadlineIn(p.days) },
        ],
      });
      const groupId = createdGroupId(receipt);
      if (!groupId) throw new Error("공구 id를 찾지 못했어요.");
      // 2) 서버가 체인의 공구가 제안과 같은지 확인하고 승인
      await api(`/admin/proposals/${p.id}/approve`, { token, body: { groupId: Number(groupId) } });
      onDone();
    } catch (e) {
      if (!tx.error) setError((e as Error).message);
    }
  };

  const reject = async () => {
    const reason = window.prompt("거절 사유");
    if (!reason) return;
    try {
      await api(`/admin/proposals/${p.id}/reject`, { token, body: { reason } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <li className="rounded-xl border border-line p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-[260px] flex-1">
          <strong className="text-base">{p.name}</strong>
          <p className="text-sm text-muted">
            {p.category} · {p.option} · 현재 {p.currentPrice.toLocaleString()}원 / 최대 {p.maxPrice.toLocaleString()}원 · 목표 {p.targetQty}개 · 1인{" "}
            {p.maxPerUser}개 · {p.days}일
          </p>
          <a href={p.url} target="_blank" rel="noreferrer" className="break-all text-sm font-bold text-accent">
            {p.url} ↗
          </a>
          {p.reason && <p className="mt-1 text-sm text-[#4A4A4A]">“{p.reason}”</p>}
          <p className="break-all font-mono text-xs text-muted">제안자 {p.proposer}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusChip s={p.status} />
          {p.groupId && (
            <Link href={`/groups/${p.groupId}`} className="text-sm font-bold underline">
              공구 #{p.groupId}
            </Link>
          )}
        </div>
      </div>
      {p.status === "pending" && (
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn-primary" disabled={!!tx.pending} onClick={approve}>
            {tx.pending ?? "승인 (공구 생성)"}
          </button>
          <button type="button" className="btn-line" onClick={reject}>
            거절
          </button>
        </div>
      )}
      {(tx.error || error) && (
        <div className="mt-3">
          <Notice tone="error">{tx.error ?? error}</Notice>
        </div>
      )}
    </li>
  );
}
