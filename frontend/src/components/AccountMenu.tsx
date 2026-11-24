"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

/** 헤더 상단: 로그인 전 "로그인", 로그인 후 "마이" (판매자·인플루언서·로그아웃은 마이페이지에서) */
export function AccountMenu() {
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const { session } = useAuth();
  useEffect(() => setMounted(true), []);

  if (!mounted) return <span className="text-[13px] text-[#4A4A4A]">로그인</span>;

  return session ? (
    <Link href="/my" className="text-[13px] font-bold text-ink hover:text-accent">
      마이
    </Link>
  ) : (
    <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="text-[13px] font-bold text-accent hover:text-accent-dark">
      로그인
    </Link>
  );
}
