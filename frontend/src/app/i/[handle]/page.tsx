"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, PublicInfluencer } from "@/lib/api";
import { useGroups } from "@/lib/hooks";
import { GroupCard } from "@/components/GroupCard";
import { Empty, GridSkeleton } from "@/components/States";
import { Notice } from "@/components/Field";

/** 인플루언서 모아 보기: 인플루언서가 SNS 프로필에 걸어 두는 링크 */
export default function InfluencerPublicPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const q = useQuery({ queryKey: ["influencer", handle], queryFn: () => api<PublicInfluencer>(`/influencers/${handle}`) });
  const { groups, isLoading } = useGroups();

  if (q.error) return <div className="mx-auto max-w-page px-4 py-16 md:px-6"><Notice tone="error">{(q.error as Error).message}</Notice></div>;
  const p = q.data;
  const mine = p ? groups.filter((g) => p.groupIds.includes(Number(g.id))) : [];
  const open = mine.filter((g) => g.statusName === "OPEN");
  const closed = mine.filter((g) => g.statusName !== "OPEN");

  return (
    <div className="mx-auto flex max-w-page flex-col gap-10 px-4 py-10 md:px-6">
      <section className="flex flex-wrap items-center gap-6 rounded-2xl bg-paper p-6 md:p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#EEF0FF] text-3xl font-extrabold text-[#3B3FB6]">
          {p?.name.slice(0, 1) ?? "·"}
        </div>
        <div className="min-w-[240px] flex-1">
          <h1 className="text-[26px] font-extrabold tracking-tight">
            {p?.name ?? "…"} <span className="text-lg font-bold text-muted">@{handle}</span>
          </h1>
          {p?.bio && <p className="mt-1 text-[15px] text-[#4A4A4A]">{p.bio}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {p?.accounts.map((a) => (
              <a key={a.platform} href={a.url} target="_blank" rel="noreferrer" className="rounded-full border border-line bg-white px-3 py-1 text-sm font-bold hover:border-ink">
                ✓ {a.label} {a.username}
              </a>
            ))}
          </div>
        </div>
        {p?.verified && <span className="rounded-full bg-safe-tint px-3 py-1.5 text-sm font-bold text-safe">SNS 계정 인증됨</span>}
      </section>

      <p className="text-sm text-muted">이 페이지의 공구는 모두 판매자 협찬(광고)이에요. 참여금은 컨트랙트에 보관되고 판매자에게만 결제돼요.</p>

      <section className="flex flex-col gap-5">
        <h2 className="section-title">진행 중인 공구</h2>
        {isLoading || !p ? (
          <GridSkeleton n={4} />
        ) : open.length ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
            {open.map((g) => (
              <GroupCard key={String(g.id)} g={g} />
            ))}
          </div>
        ) : (
          <Empty>지금 진행 중인 공구가 없어요.</Empty>
        )}
      </section>

      {closed.length > 0 && (
        <section className="flex flex-col gap-5">
          <h2 className="section-title">지난 공구</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
            {closed.map((g) => (
              <GroupCard key={String(g.id)} g={g} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
