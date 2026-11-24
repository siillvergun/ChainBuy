"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { activeChain } from "@/lib/config";
import { shortAddr } from "@/lib/groups";
import { useMe } from "@/lib/hooks";
import { useAuth } from "./AuthProvider";

/** 헤더 상단: 로그인 / (닉네임) 님 · 로그아웃, 네트워크가 다르면 전환 버튼 */
export function AccountMenu() {
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const { chainId, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { session, logout } = useAuth();
  const me = useMe(session?.token);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <span className="text-[13px] text-[#4A4A4A]">로그인</span>;

  return (
    <span className="flex items-center gap-4 text-[13px] text-[#4A4A4A]">
      {isConnected && chainId !== activeChain.id && (
        <button type="button" className="font-bold text-accent" onClick={() => switchChain({ chainId: activeChain.id })}>
          네트워크 전환
        </button>
      )}
      {session ? (
        <>
          <Link href="/my" className="font-medium text-ink hover:text-accent">
            {me.data?.nickname || shortAddr(session.address)} 님
          </Link>
          <button
            type="button"
            className="hover:text-ink"
            onClick={() => {
              logout();
              disconnect();
            }}
          >
            로그아웃
          </button>
        </>
      ) : (
        <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="font-bold text-accent hover:text-accent-dark">
          로그인
        </Link>
      )}
    </span>
  );
}
