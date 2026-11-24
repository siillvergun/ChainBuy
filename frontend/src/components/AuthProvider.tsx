"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { api } from "@/lib/api";

/**
 * 지갑 서명 로그인. 서명 한 번으로 12시간 세션 토큰을 받는다.
 * 토큰은 지갑 주소별로 브라우저에 보관하고, 지갑을 바꾸면 그 지갑의 토큰을 쓴다.
 */
type Session = { token: string; address: string; isReviewer: boolean };
type Auth = {
  session: Session | null;
  loggingIn: boolean;
  error: string | null;
  login: () => Promise<Session | null>;
  logout: () => void;
};

const Ctx = createContext<Auth | null>(null);
const key = (addr: string) => `chainbuy.session.${addr.toLowerCase()}`;

function read(addr: string): Session | null {
  try {
    const raw = localStorage.getItem(key(addr));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<Session | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSession(address ? read(address) : null);
  }, [address]);

  const login = useCallback(async () => {
    if (!address) return null;
    setError(null);
    setLoggingIn(true);
    try {
      const { message } = await api<{ message: string }>("/auth/nonce", { body: { address } });
      const signature = await signMessageAsync({ message });
      const s = await api<Session>("/auth/verify", { body: { address, signature } });
      try {
        localStorage.setItem(key(address), JSON.stringify(s));
      } catch {
        /* 저장 못 해도 이번 화면에서는 쓴다 */
      }
      setSession(s);
      return s;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("User rejected") ? "지갑에서 서명을 거절했어요." : msg);
      return null;
    } finally {
      setLoggingIn(false);
    }
  }, [address, signMessageAsync]);

  const logout = useCallback(() => {
    if (address) {
      try {
        localStorage.removeItem(key(address));
      } catch {
        /* 무시 */
      }
    }
    setSession(null);
  }, [address]);

  return <Ctx.Provider value={{ session, loggingIn, error, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider 밖에서 useAuth 사용");
  return v;
}
