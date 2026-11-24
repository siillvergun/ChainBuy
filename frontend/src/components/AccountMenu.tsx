"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { useDisconnect } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { api, Seller } from "@/lib/api";
import { shortAddr } from "@/lib/groups";
import { ONGOING, useMe, useMyGroups } from "@/lib/hooks";
import { useAuth } from "./AuthProvider";

/**
 * 헤더 맨 위 작은 텍스트 줄 (쇼핑몰 레퍼런스: 로그인 | 회원가입 | 고객센터)
 * 로그인 전: 로그인 | 판매자 입점
 * 로그인 후: 닉네임 님 | 로그아웃 | 판매자 입점(승인된 판매자는 판매자센터)
 */
export function UtilityLinks() {
  const mounted = useMounted();
  const pathname = usePathname();
  const { session, logout } = useAuth();
  const { disconnect } = useDisconnect();
  const me = useMe(session?.token);
  const seller = useQuery({
    queryKey: ["seller-me", session?.token],
    queryFn: () => api<Seller | null>("/sellers/me", { token: session!.token }),
    enabled: !!session,
  });

  const items: React.ReactNode[] = [];
  if (!mounted || !session) {
    items.push(
      <Link key="login" href={`/login?next=${encodeURIComponent(pathname)}`} className="font-bold text-ink hover:text-accent">
        로그인
      </Link>
    );
  } else {
    items.push(
      <Link key="me" href="/my" className="hover:text-ink">
        <strong className="font-bold text-ink">{me.data?.nickname || shortAddr(session.address)}</strong> 님
      </Link>,
      <button
        key="logout"
        type="button"
        className="hover:text-ink"
        onClick={() => {
          logout();
          disconnect();
        }}
      >
        로그아웃
      </button>
    );
  }
  items.push(
    <Link key="seller" href="/seller" className="hover:text-ink">
      {seller.data?.status === "approved" ? "판매자센터" : "판매자 입점"}
    </Link>
  );

  return (
    <div className="flex items-center justify-end pt-2.5 text-[13px] text-[#4A4A4A]">
      {items.map((node, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden className="mx-3 h-3 w-px bg-line" />}
          {node}
        </Fragment>
      ))}
    </div>
  );
}

/** 검색창 옆 아이콘 버튼: 공구 열기 · 마이 · 장바구니(참여 중인 공구 개수 배지) */
export function IconButtons() {
  const mounted = useMounted();
  const { session } = useAuth();
  const mine = useMyGroups(session?.address as `0x${string}` | undefined);
  const ongoing = mounted && session ? mine.filter((g) => ONGOING.has(g.statusName)).length : 0;
  const loginFirst = (to: string) => (mounted && session ? to : `/login?next=${encodeURIComponent(to)}`);

  return (
    <nav aria-label="바로가기" className="ml-auto flex items-center gap-1 sm:gap-3">
      <IconLink href="/create" label="공구 열기" icon={<path d="M12 5v14M5 12h14" />} />
      <IconLink href={loginFirst("/my")} label="마이" icon={<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></>} />
      <IconLink
        href={loginFirst("/cart")}
        label="장바구니"
        badge={ongoing}
        icon={<><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2.5 3.5h2.8l2.4 11.5h11.1l2-8H6.4" /></>}
      />
    </nav>
  );
}

function IconLink({ href, label, icon, badge = 0 }: { href: string; label: string; icon: React.ReactNode; badge?: number }) {
  return (
    <Link href={href} className="group relative flex w-14 flex-col items-center gap-0.5 py-1 text-[12px] text-[#4A4A4A] hover:text-ink sm:w-16">
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {icon}
      </svg>
      <span className="whitespace-nowrap">{label}</span>
      {badge > 0 && (
        <span
          aria-label={`참여 중 ${badge}건`}
          className="absolute right-1.5 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-white sm:right-2.5"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}
