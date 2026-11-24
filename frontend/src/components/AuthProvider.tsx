"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { api, ApiError, SESSION_EXPIRED_EVENT } from "@/lib/api";

/**
 * 지갑 서명 로그인. 서명 한 번으로 12시간 세션 토큰을 받는다.
 * 토큰은 지갑 주소별로 브라우저에 보관하고, 지갑을 바꾸면 그 지갑의 토큰을 쓴다.
 *
 * 토큰이 만료되면(시간이 지났거나 서버가 거부) 지갑 연결은 그대로 두고 세션만 "만료"로 바꾼다.
 * → 로그인이 필요한 기능은 잠기고, 화면에 "로그인이 만료됐어요. 다시 로그인해 주세요"가 나온다.
 */
type Session = { token: string; address: string; isReviewer: boolean; expiresAt?: number };
type Auth = {
  session: Session | null;
  /** 로그인했었지만 토큰이 만료된 상태 */
  expired: boolean;
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

function forget(addr?: string) {
  if (!addr) return;
  try {
    localStorage.removeItem(key(addr));
  } catch {
    /* 무시 */
  }
}

const isPast = (t?: number) => !!t && t <= Date.now();

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<Session | null>(null);
  const [expired, setExpired] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expire = useCallback(() => {
    forget(address);
    setSession((s) => {
      if (s) setExpired(true);
      return null;
    });
  }, [address]);

  // 지갑이 바뀌면 그 지갑의 저장된 세션을 불러오고, 아직 유효한지 서버에 확인한다
  useEffect(() => {
    setExpired(false);
    if (!address) return setSession(null);
    const s = read(address);
    if (!s) return setSession(null);
    if (isPast(s.expiresAt)) {
      forget(address);
      setSession(null);
      setExpired(true);
      return;
    }
    setSession(s);
    api<{ expiresAt: number }>("/auth/me", { token: s.token })
      .then((me) => setSession((cur) => (cur?.token === s.token ? { ...cur, expiresAt: me.expiresAt } : cur)))
      .catch((e) => {
        // 서버가 꺼져 있는 경우(0)는 만료로 보지 않는다
        if (e instanceof ApiError && e.status === 401) expire();
      });
  }, [address, expire]);

  // 만료 시각이 되면 자동으로 만료 처리
  useEffect(() => {
    if (!session?.expiresAt) return;
    const ms = session.expiresAt - Date.now();
    if (ms <= 0) return expire();
    const t = setTimeout(expire, Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [session?.expiresAt, expire]);

  // 어느 화면에서든 API가 토큰을 거부(401)하면 만료 처리
  useEffect(() => {
    const on = () => expire();
    window.addEventListener(SESSION_EXPIRED_EVENT, on);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, on);
  }, [expire]);

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
      setExpired(false);
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
    forget(address);
    setSession(null);
    setExpired(false);
  }, [address]);

  return <Ctx.Provider value={{ session, expired, loggingIn, error, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider 밖에서 useAuth 사용");
  return v;
}
