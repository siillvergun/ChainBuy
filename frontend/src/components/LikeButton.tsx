"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useLikes } from "@/lib/hooks";
import { useAuth } from "./AuthProvider";

/** 하트(찜) 버튼. 로그인 전에 누르면 로그인 화면으로 보낸다 */
export function LikeButton({ groupId, variant = "overlay", showCount = false }: { groupId: number; variant?: "overlay" | "plain"; showCount?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { session } = useAuth();
  const { liked, counts, toggle } = useLikes(session?.token);
  useEffect(() => setMounted(true), []);

  const on = mounted && liked.has(groupId);
  const count = counts[groupId] ?? 0;

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!session) return router.push(`/login?next=${encodeURIComponent(pathname)}`);
    void toggle(groupId);
  };

  const heart = (
    <svg viewBox="0 0 24 24" className={variant === "overlay" ? "h-6 w-6" : "h-6 w-6"} aria-hidden>
      <path
        d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"
        fill={on ? "#D9411E" : variant === "overlay" ? "rgba(0,0,0,0.25)" : "none"}
        stroke={on ? "#D9411E" : variant === "overlay" ? "#fff" : "#111"}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );

  if (variant === "overlay")
    return (
      <button type="button" aria-pressed={on} aria-label={on ? "찜 해제" : "찜하기"} onClick={onClick} className="flex h-10 w-10 items-center justify-center">
        {heart}
      </button>
    );

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "찜 해제" : "찜하기"}
      onClick={onClick}
      className={`flex h-11 items-center gap-1.5 rounded-md border px-3 text-sm font-bold ${on ? "border-accent text-accent" : "border-line text-ink hover:border-ink"}`}
    >
      {heart}
      {showCount ? <span>{count.toLocaleString()}</span> : <span>찜</span>}
    </button>
  );
}
