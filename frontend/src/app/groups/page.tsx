"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useGroups } from "@/lib/hooks";
import { isClosingToday } from "@/lib/groups";
import { GroupCard } from "@/components/GroupCard";
import { ChainNotice, Empty, GridSkeleton } from "@/components/States";

const CATS = ["전체", "디지털", "식품", "캠핑", "생활", "육아", "주방"];
const KINDS = [
  { v: "", label: "전체" },
  { v: "listed", label: "판매자 특가" },
  { v: "external", label: "추천 공구" },
];
const SORTS = [
  { v: "popular", label: "인기순" },
  { v: "deadline", label: "마감임박순" },
  { v: "new", label: "최신순" },
];

export default function GroupsPage() {
  return (
    <Suspense>
      <GroupList />
    </Suspense>
  );
}

function GroupList() {
  const sp = useSearchParams();
  const router = useRouter();
  const { groups, isLoading, error } = useGroups();

  const cat = sp.get("cat") ?? "전체";
  const kind = sp.get("kind") ?? "";
  const sort = sp.get("sort") ?? "popular";
  const q = sp.get("q") ?? "";
  const today = sp.get("filter") === "today";
  const showClosed = sp.get("closed") === "1";

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString());
    if (v) n.set(k, v);
    else n.delete(k);
    router.replace(`/groups?${n.toString()}`, { scroll: false });
  };

  const list = useMemo(() => {
    let l = groups.filter((g) => showClosed || g.statusName === "OPEN");
    if (cat !== "전체") l = l.filter((g) => g.product?.category === cat);
    if (kind) l = l.filter((g) => (kind === "listed" ? g.isListed : !g.isListed));
    if (today) l = l.filter((g) => isClosingToday(g.deadline));
    if (q) l = l.filter((g) => g.product?.name.includes(q));
    const s = [...l];
    if (sort === "popular") s.sort((a, b) => b.totalQty / b.targetQty - a.totalQty / a.targetQty);
    if (sort === "deadline") s.sort((a, b) => Number(a.deadline - b.deadline));
    if (sort === "new") s.sort((a, b) => Number(b.id - a.id));
    return s;
  }, [groups, cat, kind, sort, q, today, showClosed]);

  return (
    <div className="mx-auto flex max-w-page flex-col gap-6 px-4 py-8 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[28px] font-extrabold tracking-tight">
          {q
            ? `'${q}' 검색 결과`
            : today
              ? "오늘 마감"
              : kind === "listed"
                ? "판매자 특가"
                : kind === "external"
                  ? "추천 공구"
                  : sp.get("sort") === "popular"
                    ? "인기 공구"
                    : "전체 공구"}
        </h1>
        <span className="text-sm text-muted">{list.length}개</span>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="카테고리">
        {CATS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => set("cat", c === "전체" ? "" : c)}
            className={`h-9 rounded-full border px-4 text-sm font-bold ${cat === c ? "border-ink bg-ink text-white" : "border-line hover:border-ink"}`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-line py-3 text-sm">
        <div className="flex gap-4">
          {KINDS.map((k) => (
            <button key={k.v} type="button" onClick={() => set("kind", k.v)} className={kind === k.v ? "font-bold text-ink" : "text-muted hover:text-ink"}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-muted">
            <input type="checkbox" checked={showClosed} onChange={(e) => set("closed", e.target.checked ? "1" : "")} />
            종료된 공구 포함
          </label>
          {SORTS.map((s) => (
            <button key={s.v} type="button" onClick={() => set("sort", s.v)} className={sort === s.v ? "font-bold text-ink" : "text-muted hover:text-ink"}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <ChainNotice error={error} />

      {isLoading ? (
        <GridSkeleton n={8} />
      ) : list.length ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">
          {list.map((g) => (
            <GroupCard key={String(g.id)} g={g} />
          ))}
        </div>
      ) : (
        <Empty>
          조건에 맞는 공구가 없어요.{" "}
          <Link href="/create" className="font-bold text-accent">
            직접 공구 열기
          </Link>
        </Empty>
      )}
    </div>
  );
}
