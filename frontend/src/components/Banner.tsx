"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Slide = { kicker: string; kickerColor?: string; title: string; sub: string; href: string; cta: string; bg: string; fg: string };

const SLIDES: Slide[] = [
  { kicker: "기획전", title: "겨울 캠핑 공구전", sub: "의자·랜턴·텀블러 최대 30% · 목표 인원이 차면 바로 출발", href: "/groups?cat=%EC%BA%A0%ED%95%91", cta: "보러 가기", bg: "#1F3A2E", fg: "#FFFFFF" },
  { kicker: "판매자 특가", title: "판매자가 직접 연 공구", sub: "구매자 수수료 0원 · 결제 즉시 판매자 정산", href: "/groups?kind=listed", cta: "보러 가기", bg: "#FFE7DD", fg: "#111111" },
  { kicker: "이번 주", title: "커피 원두 공구", sub: "산지 원두 1kg부터 · 인원 미달이면 전액 환불", href: "/groups?cat=%EC%8B%9D%ED%92%88", cta: "보러 가기", bg: "#F1E8DC", fg: "#111111" },
  { kicker: "써 보고 좋았던 상품", kickerColor: "#D9411E", title: "내가 직접 공구 열기", sub: "판매자 특가 상품이나 대형 쇼핑몰 상품으로", href: "/create", cta: "공구 열기", bg: "#FFF1EC", fg: "#111111" },
  { kicker: "안심결제", kickerColor: "#0E7A4F", title: "돈은 사람에게 가지 않아요", sub: "참여금은 컨트랙트에, 결제는 등록된 판매자에게만", href: "/groups", cta: "공구 둘러보기", bg: "#EAF6EF", fg: "#111111" },
];

const N = SLIDES.length;
// 끝에서 처음으로 넘어갈 때도 같은 방향으로 미끄러지도록 앞뒤에 복제 슬라이드를 붙인다: [마지막, 1, 2, 3, 첫째]
const TRACK = [SLIDES[N - 1], ...SLIDES, SLIDES[0]];

export function Banner() {
  const [pos, setPos] = useState(1); // TRACK 안의 위치 (1..N이 실제 슬라이드)
  const [animate, setAnimate] = useState(true);
  const [moving, setMoving] = useState(false);
  const [playing, setPlaying] = useState(true);
  const i = (pos - 1 + N) % N; // 지금 보이는 실제 슬라이드 번호

  const posRef = useRef(pos);
  posRef.current = pos;
  const fallback = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 복제 슬라이드에 도착하면 애니메이션 없이 진짜 슬라이드 위치로 순간 이동
  const settle = () => {
    clearTimeout(fallback.current);
    setMoving(false);
    const p = posRef.current;
    if (p === N + 1 || p === 0) {
      setAnimate(false);
      setPos(p === 0 ? N : 1);
    }
  };

  const go = (dir: 1 | -1) => {
    if (moving) return; // 넘어가는 중에는 연타 무시
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // 움직임 줄이기 설정: 미끄러지지 않고 바로 바뀐다
      setAnimate(false);
      setPos((p) => (((p - 1 + dir + N) % N) + 1));
      return;
    }
    setMoving(true);
    setAnimate(true);
    setPos((p) => p + dir);
    // transitionend가 오지 않는 경우(탭이 가려짐 등)에도 멈추지 않게
    fallback.current = setTimeout(settle, 700);
  };

  useEffect(() => () => clearTimeout(fallback.current), []);

  // 순간 이동이 화면에 반영된 다음 프레임에 애니메이션을 다시 켠다
  useEffect(() => {
    if (animate) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)));
    return () => cancelAnimationFrame(id);
  }, [animate]);

  // 슬라이드가 바뀔 때마다 5초를 새로 센다 (버튼으로 넘긴 직후 바로 또 넘어가지 않게)
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => go(1), 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, pos]);

  return (
    <section aria-roledescription="carousel" aria-label="기획전 배너">
      <div className="relative min-h-[260px] overflow-hidden rounded-xl md:min-h-[340px]">
        {/* 슬라이드를 가로로 이어 붙이고, 트랙 전체를 옆으로 밀어서 넘긴다 */}
        <div
          className={`flex h-full ${animate ? "transition-transform duration-500 ease-out motion-reduce:transition-none" : ""}`}
          style={{ transform: `translateX(-${pos * 100}%)` }}
          onTransitionEnd={(e) => e.target === e.currentTarget && settle()}
        >
          {TRACK.map((s, t) => (
            <div
              key={`${t}-${s.title}`}
              role="group"
              aria-roledescription="slide"
              aria-label={`${((t - 1 + N) % N) + 1} / ${N}`}
              aria-hidden={t !== pos}
              className="flex min-h-[260px] w-full shrink-0 flex-col justify-end p-7 md:min-h-[340px] md:p-10"
              style={{ background: s.bg, color: s.fg }}
            >
              <span className="text-sm font-bold" style={s.kickerColor ? { color: s.kickerColor } : { opacity: 0.8 }}>
                {s.kicker}
              </span>
              {t === 1 ? (
                <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-[44px] md:leading-tight">{s.title}</h1>
              ) : (
                <h2 className="mt-2 text-3xl font-extrabold tracking-tight md:text-[44px] md:leading-tight">{s.title}</h2>
              )}
              <p className="mt-3 max-w-md text-[15px] opacity-85">{s.sub}</p>
              <Link
                href={s.href}
                tabIndex={t === pos ? 0 : -1}
                className="mt-6 w-fit rounded-md bg-white/90 px-4 py-2.5 text-sm font-bold text-ink hover:bg-white"
              >
                {s.cta}
              </Link>
            </div>
          ))}
        </div>
        <div className="absolute bottom-5 right-5 flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-xs text-white">
          <button type="button" aria-label="이전 배너" className="px-1.5" onClick={() => go(-1)}>
            ‹
          </button>
          <span aria-live="polite">
            {i + 1} / {N}
          </span>
          <button type="button" aria-label="다음 배너" className="px-1.5" onClick={() => go(1)}>
            ›
          </button>
          <button type="button" aria-label={playing ? "자동 넘김 멈춤" : "자동 넘김 시작"} className="px-1.5" onClick={() => setPlaying(!playing)}>
            {playing ? "❚❚" : "▶"}
          </button>
        </div>
      </div>
    </section>
  );
}
