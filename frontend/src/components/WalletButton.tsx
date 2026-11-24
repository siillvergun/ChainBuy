"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { activeChain } from "@/lib/config";
import { shortAddr } from "@/lib/groups";

/** 헤더 상단 유틸 영역의 지갑 연결 표시 */
export function WalletButton() {
  const [mounted, setMounted] = useState(false);
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  useEffect(() => setMounted(true), []);

  if (!mounted) return <span className="text-[13px] text-[#4A4A4A]">지갑 연결</span>;

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <button
        type="button"
        className="text-[13px] font-bold text-accent hover:text-accent-dark"
        disabled={isPending || !injected}
        onClick={() => injected && connect({ connector: injected })}
      >
        {isPending ? "연결 중…" : "지갑 연결"}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-3 text-[13px] text-[#4A4A4A]">
      {chainId !== activeChain.id && (
        <button type="button" className="font-bold text-accent" onClick={() => switchChain({ chainId: activeChain.id })}>
          네트워크 전환
        </button>
      )}
      <span className="font-medium text-ink">{shortAddr(address)} 님</span>
      <button type="button" onClick={() => disconnect()} className="hover:text-ink">
        연결 해제
      </button>
    </span>
  );
}
