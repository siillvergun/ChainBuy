"use client";

import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { REFETCH_INTERVAL_MS, wagmiConfig } from "@/lib/config";
import { AuthProvider } from "./AuthProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  // 탭이 안 보일 때는 다시 읽지 않는다 (react-query 기본값 refetchIntervalInBackground: false).
  // 트랜잭션 뒤에는 각 화면이 refetch를 직접 불러 바로 갱신한다
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchInterval: REFETCH_INTERVAL_MS } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
