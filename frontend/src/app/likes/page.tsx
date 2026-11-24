"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { LoginGate } from "@/components/LoginGate";
import { GroupCard } from "@/components/GroupCard";
import { ChainNotice, Empty, GridSkeleton } from "@/components/States";
import { useGroups, useLikes } from "@/lib/hooks";

/** 찜: 참여하기 전에 담아 둔 공구 */
export default function LikesPage() {
  return (
    <div className="mx-auto flex max-w-page flex-col gap-6 px-4 py-10 md:px-6">
      <h1 className="text-[28px] font-extrabold tracking-tight">찜</h1>
      <LoginGate what="찜">
        <Likes />
      </LoginGate>
    </div>
  );
}

function Likes() {
  const { session } = useAuth();
  const { ids } = useLikes(session!.token);
  const { groups, isLoading, error } = useGroups();
  const [tab, setTab] = useState<"open" | "closed">("open");

  // 찜한 순서대로
  const liked = ids.map((id) => groups.find((g) => Number(g.id) === id)).filter((g) => g !== undefined);
  const open = liked.filter((g) => g.statusName === "OPEN");
  const closed = liked.filter((g) => g.statusName !== "OPEN");
  const list = tab === "open" ? open : closed;

  return (
    <>
      <p className="-mt-3 text-[15px] text-muted">마음에 드는 공구를 담아 두고, 마감 전에 참여하세요. 이미 참여한 공구는 장바구니에서 볼 수 있어요.</p>
      <ChainNotice error={error} />
      <div role="tablist" className="flex gap-6 border-b border-line">
        {(
          [
            ["open", `모집 중 ${open.length}`],
            ["closed", `모집 끝 ${closed.length}`],
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
      {isLoading ? (
        <GridSkeleton n={4} />
      ) : list.length ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">
          {list.map((g) => (
            <GroupCard key={String(g.id)} g={g} />
          ))}
        </div>
      ) : (
        <Empty>
          {tab === "open" ? "찜한 공구가 없어요. 공구 카드의 하트를 눌러 담아 보세요." : "모집이 끝난 찜 공구가 없어요."}{" "}
          <Link href="/groups" className="font-bold text-accent">
            공구 둘러보기
          </Link>
        </Empty>
      )}
    </>
  );
}
