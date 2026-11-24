import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

const noto = Noto_Sans_KR({ subsets: ["latin"], weight: ["400", "500", "700", "800"], variable: "--font-noto" });

export const metadata: Metadata = {
  title: "ChainBuy — 안심 공동구매",
  description: "참여금은 컨트랙트에, 결제는 등록된 곳으로만. 인원이 안 모이거나 가격이 오르면 전액 환불.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={noto.variable}>
        <Providers>
          <Header />
          <main className="min-h-[60vh]">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
