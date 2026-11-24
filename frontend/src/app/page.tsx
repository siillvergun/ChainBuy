"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useGroups } from "@/lib/hooks";
import { isClosingToday } from "@/lib/groups";
import { GroupCard } from "@/components/GroupCard";
import { Banner } from "@/components/Banner";
import { ChainNotice, Empty, GridSkeleton } from "@/components/States";
import { CategoryRail } from "@/components/CategoryRail";

export default function Home() {
  const { groups, isLoading, error } = useGroups();
  const open = useMemo(() => groups.filter((g) => g.statusName === "OPEN"), [groups]);
  const popular = useMemo(() => [...open].sort((a, b) => b.totalQty / b.targetQty - a.totalQty / a.targetQty).slice(0, 8), [open]);
  const today = useMemo(() => open.filter((g) => isClosingToday(g.deadline)).slice(0, 4), [open]);
  const listed = useMemo(() => open.filter((g) => g.isListed).slice(0, 4), [open]);

  return (
    <div className="mx-auto flex max-w-page flex-col gap-14 px-4 py-6 md:px-6">
      <Banner />

      <CategoryRail />

      <ChainNotice error={error} />

      <Section title="실시간 인기 공구" desc="지금 사람이 가장 많이 모이는 공동구매" more="/groups?sort=popular">
        {isLoading ? (
          <GridSkeleton n={8} />
        ) : popular.length ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
            {popular.map((g, i) => (
              <GroupCard key={String(g.id)} g={g} rank={i + 1} />
            ))}
          </div>
        ) : (
          <Empty>
            진행 중인 공구가 없어요.{" "}
            <Link href="/create" className="font-bold text-accent">
              첫 공구 열기
            </Link>
          </Empty>
        )}
      </Section>

      {today.length > 0 && (
        <Section title="오늘 마감" desc="24시간 안에 모집이 끝나요" more="/groups?filter=today">
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
            {today.map((g) => (
              <GroupCard key={String(g.id)} g={g} />
            ))}
          </div>
        </Section>
      )}

      {listed.length > 0 && (
        <Section title="판매자 특가" desc="입점 판매자가 직접 연 공구 · 구매자 수수료 0원" more="/groups?kind=listed">
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
            {listed.map((g) => (
              <GroupCard key={String(g.id)} g={g} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, desc, more, children }: { title: string; desc: string; more: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="section-title">{title}</h2>
          <p className="mt-1 text-sm text-muted">{desc}</p>
        </div>
        <Link href={more} className="shrink-0 text-sm font-bold text-[#4A4A4A] hover:text-ink">
          더보기 ›
        </Link>
      </div>
      {children}
    </section>
  );
}
