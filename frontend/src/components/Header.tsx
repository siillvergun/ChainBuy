"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { WalletButton } from "./WalletButton";

const NAV = [
  { href: "/", label: "홈" },
  { href: "/groups", label: "전체 공구" },
  { href: "/groups?sort=popular", label: "인기 공구" },
  { href: "/groups?filter=today", label: "오늘 마감" },
  { href: "/groups?kind=listed", label: "판매자 특가" },
  { href: "/groups?kind=external", label: "추천 공구" },
];

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");

  return (
    <>
      <div className="bg-ink px-4 py-2.5 text-center text-[13px] text-white">
        모든 공동구매 안심결제 · 인원 미달이거나 가격이 오르면 전액 환불
      </div>
      <header className="border-b border-line bg-white">
        <div className="mx-auto max-w-page px-4 md:px-6">
          <div className="flex flex-wrap justify-end gap-4 pt-2.5 text-[13px] text-[#4A4A4A]">
            <WalletButton />
            <Link href="/login" className="hover:text-ink">
              로그인
            </Link>
            <Link href="/login?tab=signup" className="hover:text-ink">
              회원가입
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 py-3">
            <Link href="/" className="text-[28px] font-extrabold tracking-tight text-ink">
              Chain<span className="text-accent">Buy</span>
            </Link>
            <form
              role="search"
              className="flex h-[46px] min-w-0 max-w-[520px] flex-[1_1_280px] items-center rounded-md border-2 border-ink pl-3.5 pr-3"
              onSubmit={(e) => {
                e.preventDefault();
                router.push(`/groups?q=${encodeURIComponent(q)}`);
              }}
            >
              <label htmlFor="search" className="sr-only">
                공동구매 검색
              </label>
              <input
                id="search"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="캠핑 의자, 원두, 무선 이어폰"
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              />
              <button type="submit" aria-label="검색">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
              </button>
            </form>
            <div className="ml-auto flex gap-2.5">
              <Link href="/create" className="btn-line">
                공동구매 열기
              </Link>
              <Link href="/my" className="btn-primary">
                내 참여
              </Link>
            </div>
          </div>
          <nav aria-label="공동구매 분류" className="-mb-px flex gap-7 overflow-x-auto text-[15px] font-bold">
            {NAV.map((n) => {
              const active = n.href === "/" ? pathname === "/" : n.href === "/groups" && pathname === "/groups";
              return (
                <Link
                  key={n.label}
                  href={n.href}
                  className={`whitespace-nowrap border-b-2 py-2.5 ${active ? "border-ink text-ink" : "border-transparent text-[#4A4A4A] hover:text-ink"}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
    </>
  );
}
