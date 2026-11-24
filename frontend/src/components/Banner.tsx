"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const SLIDES = [
  { kicker: "기획전", title: "겨울 캠핑 공구전", sub: "의자·랜턴·텀블러 최대 30% · 목표 인원이 차면 바로 출발", href: "/groups?cat=%EC%BA%A0%ED%95%91", bg: "#1F3A2E", fg: "#FFFFFF" },
  { kicker: "판매자 특가", title: "판매자가 직접 연 공구", sub: "구매자 수수료 0원 · 결제 즉시 판매자 정산", href: "/groups?kind=listed", bg: "#FFE7DD", fg: "#111111" },
  { kicker: "이번 주", title: "커피 원두 공구", sub: "산지 원두 1kg부터 · 인원 미달이면 전액 환불", href: "/groups?cat=%EC%8B%9D%ED%92%88", bg: "#F1E8DC", fg: "#111111" },
];

export function Banner() {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setI((x) => (x + 1) % SLIDES.length), 5000);
    return () => clearInterval(t);
  }, [playing]);

  const s = SLIDES[i];
  return (
    <section aria-roledescription="carousel" aria-label="기획전 배너" className="grid gap-3 md:grid-cols-[2fr_1fr]">
      <div className="relative flex min-h-[260px] flex-col justify-end rounded-xl p-7 md:min-h-[340px] md:p-10" style={{ background: s.bg, color: s.fg }}>
        <span className="text-sm font-bold opacity-80">{s.kicker}</span>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-[44px] md:leading-tight">{s.title}</h1>
        <p className="mt-3 max-w-md text-[15px] opacity-85">{s.sub}</p>
        <Link href={s.href} className="mt-6 w-fit rounded-md bg-white/90 px-4 py-2.5 text-sm font-bold text-ink hover:bg-white">
          보러 가기
        </Link>
        <div className="absolute bottom-5 right-5 flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-xs text-white">
          <button type="button" aria-label="이전 배너" className="px-1.5" onClick={() => setI((i - 1 + SLIDES.length) % SLIDES.length)}>
            ‹
          </button>
          <span aria-live="polite">
            {i + 1} / {SLIDES.length}
          </span>
          <button type="button" aria-label="다음 배너" className="px-1.5" onClick={() => setI((i + 1) % SLIDES.length)}>
            ›
          </button>
          <button type="button" aria-label={playing ? "자동 넘김 멈춤" : "자동 넘김 시작"} className="px-1.5" onClick={() => setPlaying(!playing)}>
            {playing ? "❚❚" : "▶"}
          </button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1">
        <Link href="/create" className="flex flex-col justify-center rounded-xl bg-accent-tint p-6 hover:brightness-[0.98]">
          <span className="text-xs font-bold text-accent">써 보고 좋았던 상품</span>
          <strong className="mt-1 text-lg font-extrabold">내가 직접 공구 열기</strong>
          <span className="mt-1 text-sm text-[#4A4A4A]">판매자 특가 상품이나 대형 쇼핑몰 상품으로</span>
        </Link>
        <div className="flex flex-col justify-center rounded-xl bg-safe-tint p-6">
          <span className="text-xs font-bold text-safe">안심결제</span>
          <strong className="mt-1 text-lg font-extrabold">돈은 사람에게 가지 않아요</strong>
          <span className="mt-1 text-sm text-[#4A4A4A]">참여금은 컨트랙트에, 결제는 등록된 판매자에게만</span>
        </div>
      </div>
    </section>
  );
}
