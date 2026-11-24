"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { useAuth } from "@/components/AuthProvider";
import { Notice } from "@/components/Field";
import { shortAddr } from "@/lib/groups";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

/** 안전한 내부 경로만 돌아갈 곳으로 허용 (외부 주소로 튀는 것 방지) */
function safeNext(raw: string | null) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/my";
}

/**
 * 지갑 로그인: 지갑 연결 → 문구에 서명 → 원래 보던 페이지로 돌아간다.
 * 서명은 거래가 아니라 수수료가 들지 않는다. 지갑 주소가 곧 계정이라 따로 가입할 필요가 없다.
 */
function Login() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { session, expired, login, loggingIn, error } = useAuth();

  useEffect(() => {
    if (session) router.replace(next);
  }, [session, next, router]);

  return (
    <div className="mx-auto flex max-w-[440px] flex-col gap-6 px-4 py-14">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">로그인</h1>
        <p className="mt-2 text-[15px] leading-6 text-muted">지갑이 곧 계정이에요. 따로 가입하지 않아도 되고, 처음 로그인하면 마이페이지에서 닉네임과 배송지를 등록할 수 있어요.</p>
      </div>

      <ol className="flex flex-col gap-3">
        <Step n={1} done={isConnected} title="지갑 연결" desc={isConnected ? `${shortAddr(address)} 연결됨` : "MetaMask 같은 브라우저 지갑을 연결해요"}>
          {!isConnected && (
            <button type="button" className="btn-dark" disabled={isPending || !connectors[0]} onClick={() => connect({ connector: connectors[0] })}>
              {isPending ? "연결 중…" : "지갑 연결"}
            </button>
          )}
        </Step>
        <Step n={2} done={!!session} title="서명으로 로그인" desc="문구에 한 번 서명해요. 거래가 아니라 수수료가 들지 않아요">
          {isConnected && !session && (
            <button type="button" className="btn-primary" disabled={loggingIn} onClick={() => void login()}>
              {loggingIn ? "서명 기다리는 중…" : "서명하고 로그인"}
            </button>
          )}
        </Step>
      </ol>

      {expired && <Notice tone="error">로그인이 만료됐어요. 서명을 한 번 더 하면 다시 로그인돼요.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!connectors[0] && <Notice tone="error">브라우저 지갑을 찾지 못했어요. MetaMask를 설치한 뒤 새로고침해 주세요.</Notice>}

      <p className="text-center text-sm text-muted">
        로그인 없이도 <Link href="/groups" className="font-bold text-ink underline">공구 둘러보기</Link>는 할 수 있어요.
      </p>
    </div>
  );
}

function Step({ n, done, title, desc, children }: { n: number; done: boolean; title: string; desc: string; children?: React.ReactNode }) {
  return (
    <li className={`flex flex-wrap items-center gap-4 rounded-xl border p-4 ${done ? "border-safe bg-safe-tint" : "border-line"}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-safe text-white" : "bg-line text-muted"}`}>
        {done ? "✓" : n}
      </span>
      <div className="min-w-[160px] flex-1">
        <strong className="block">{title}</strong>
        <span className="text-sm text-muted">{desc}</span>
      </div>
      {children}
    </li>
  );
}
