"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { useAuth } from "./AuthProvider";
import { NetworkCheck } from "./NetworkCheck";

/** 지갑 연결 + 서명 로그인이 필요한 화면을 감싼다 */
export function LoginGate({ children, what = "이 기능" }: { children: React.ReactNode; what?: string }) {
  const [mounted, setMounted] = useState(false);
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { session, login, loggingIn, error } = useAuth();
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;
  if (session)
    return (
      <>
        <NetworkCheck />
        {children}
      </>
    );

  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-paper p-6">
      <strong className="text-lg">{what}을(를) 쓰려면 로그인이 필요해요</strong>
      <p className="text-[15px] leading-6 text-[#4A4A4A]">
        지갑으로 문구에 한 번 서명하면 로그인돼요. 서명은 거래가 아니라서 수수료가 들지 않아요.
      </p>
      {!isConnected ? (
        <button type="button" className="btn-dark" onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
          지갑 연결
        </button>
      ) : (
        <button type="button" className="btn-primary" disabled={loggingIn} onClick={() => void login()}>
          {loggingIn ? "서명 기다리는 중…" : "지갑으로 로그인"}
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-accent-dark">
          {error}
        </p>
      )}
    </div>
  );
}
