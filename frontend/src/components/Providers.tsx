"use client";

import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/config";
import { AuthProvider } from "./AuthProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchInterval: 8_000 } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
