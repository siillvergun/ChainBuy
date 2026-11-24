"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { IconButtons, UtilityLinks } from "./AccountMenu";

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
          <UtilityLinks />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3 md:gap-x-8">
            <Link href="/" className="text-[24px] font-extrabold tracking-tight text-ink sm:text-[28px]">
              Chain<span className="text-accent">Buy</span>
            </Link>
            <form
              role="search"
              className="order-last flex h-[46px] min-w-0 basis-full items-center rounded-md border-2 border-ink pl-3.5 pr-3 md:order-none md:max-w-[520px] md:flex-[1_1_280px] md:basis-auto"
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
            <IconButtons />
          </div>
          <Suspense fallback={<NavLinks pathname={pathname} params={null} />}>
            <NavWithParams pathname={pathname} />
          </Suspense>
        </div>
      </header>
    </>
  );
}

function NavWithParams({ pathname }: { pathname: string }) {
  const params = useSearchParams();
  return <NavLinks pathname={pathname} params={params} />;
}

/** 현재 주소(경로 + 쿼리)에 맞는 메뉴 하나만 밑줄로 표시한다 */
function activeLabel(pathname: string, params: URLSearchParams | null): string | null {
  if (pathname === "/") return "홈";
  if (pathname !== "/groups") return null;
  if (params?.get("filter") === "today") return "오늘 마감";
  if (params?.get("kind") === "listed") return "판매자 특가";
  if (params?.get("kind") === "external") return "추천 공구";
  if (params?.get("sort") === "popular") return "인기 공구";
  return "전체 공구";
}

function NavLinks({ pathname, params }: { pathname: string; params: URLSearchParams | null }) {
  const current = activeLabel(pathname, params);
  return (
    <nav aria-label="공동구매 분류" className="-mb-px flex gap-7 overflow-x-auto text-[15px] font-bold">
      {NAV.map((n) => {
        const active = n.label === current;
        return (
          <Link
            key={n.label}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 py-2.5 ${active ? "border-ink text-ink" : "border-transparent text-[#4A4A4A] hover:text-ink"}`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
