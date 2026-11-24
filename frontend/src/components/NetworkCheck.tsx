"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { activeChain } from "@/lib/config";

/**
 * 지갑이 앱과 다른 네트워크에 연결돼 있으면, 거래가 엉뚱한 체인으로 가지 않도록 전환을 안내한다.
 * 헤더에 늘 띄우지 않고 거래가 필요한 화면에서만 보여 준다.
 */
export function NetworkCheck() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  if (!isConnected || chainId === activeChain.id) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-accent-line bg-accent-tint p-3 text-sm text-accent-dark">
      <span className="min-w-[200px] flex-1">
        지갑이 다른 네트워크에 연결돼 있어요. <strong>{activeChain.name}</strong>로 바꿔야 거래할 수 있어요.
      </span>
      <button type="button" className="btn-primary h-9" disabled={isPending} onClick={() => switchChain({ chainId: activeChain.id })}>
        {isPending ? "전환 중…" : "네트워크 전환"}
      </button>
    </div>
  );
}
