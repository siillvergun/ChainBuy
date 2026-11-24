"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/categories";

const COPIES = 3; // [복제, 진짜, 복제] — 가운데 묶음 근처를 벗어나면 한 묶음만큼 몰래 되돌려 끝없이 이어지게 한다
const AUTO_SPEED = 24; // 자동으로 흐르는 속도 (px/초)
const RESUME_MS = 2000; // 직접 움직인 뒤 다시 흐르기까지 기다리는 시간

/**
 * 메인 카테고리 줄 (무한 스크롤)
 * - 마우스: 잡고 끌어서 넘기고, 놓으면 관성으로 조금 더 굴러간다. 끌었을 때는 링크가 눌리지 않음
 * - 터치·트랙패드: 기본 가로 스크롤
 * - 어느 방향으로든 끝없이 이어진다
 * - 가만히 두면 천천히 흐른다 (마우스를 올리거나 직접 움직이면 멈춤, 동작 줄이기 설정이면 흐르지 않음)
 */
export function CategoryRail() {
  const ref = useRef<HTMLDivElement>(null);
  const setWidth = useRef(0); // 카테고리 한 묶음의 너비
  const drag = useRef({ down: false, startX: 0, startLeft: 0, moved: false, lastX: 0, lastT: 0, v: 0 });
  const inertia = useRef<number | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  // 한 묶음 너비를 재고 가운데 묶음에서 시작
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const prev = setWidth.current;
      setWidth.current = el.scrollWidth / COPIES;
      el.scrollLeft = prev ? el.scrollLeft - prev + setWidth.current : setWidth.current;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => () => stopInertia(), []);

  // 자동으로 천천히 흐르게 한다. 마우스를 올리거나, 끌거나, 직접 스크롤하면 멈추고 잠시 뒤 다시 흐른다.
  const hover = useRef(false);
  const lastTouch = useRef(0);
  const touched = () => (lastTouch.current = performance.now());
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let prev = performance.now();
    let carry = 0; // 1px 미만 이동량을 모아 두었다가 정수로 반영
    const tick = (now: number) => {
      const dt = Math.min(64, now - prev);
      prev = now;
      const el = ref.current;
      const idle = !hover.current && !drag.current.down && inertia.current === null && now - lastTouch.current > RESUME_MS;
      if (el && idle && !reduced.matches) {
        carry += (AUTO_SPEED * dt) / 1000;
        if (carry >= 1) {
          const px = Math.floor(carry);
          carry -= px;
          el.scrollLeft += px;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** 가운데 묶음을 벗어나면 한 묶음 너비만큼 되돌린다 (화면상 같은 위치라 티가 안 남) */
  const wrap = () => {
    const el = ref.current!;
    const w = setWidth.current;
    if (!w) return;
    let shift = 0;
    if (el.scrollLeft < w * 0.5) shift = w;
    else if (el.scrollLeft > w * 1.5) shift = -w;
    if (shift) {
      el.scrollLeft += shift;
      drag.current.startLeft += shift; // 끄는 중이면 기준점도 같이 옮긴다
    }
  };

  const stopInertia = () => {
    if (inertia.current !== null) cancelAnimationFrame(inertia.current);
    inertia.current = null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    stopInertia();
    const now = performance.now();
    drag.current = { down: true, startX: e.clientX, startLeft: ref.current!.scrollLeft, moved: false, lastX: e.clientX, lastT: now, v: 0 };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.down) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > 5) {
      d.moved = true;
      setGrabbing(true);
      ref.current!.setPointerCapture(e.pointerId);
    }
    if (!d.moved) return;
    const now = performance.now();
    d.v = (e.clientX - d.lastX) / Math.max(1, now - d.lastT); // px/ms
    d.lastX = e.clientX;
    d.lastT = now;
    ref.current!.scrollLeft = d.startLeft - dx;
  };

  const endDrag = () => {
    const d = drag.current;
    if (!d.down) return;
    d.down = false;
    setGrabbing(false);
    touched();
    if (!d.moved) return;
    // 놓을 때의 속도로 조금 더 굴러가다 멈춘다
    let v = -d.v * 16; // px/frame
    const step = () => {
      if (Math.abs(v) < 0.5) return stopInertia();
      ref.current!.scrollLeft += v;
      v *= 0.94;
      inertia.current = requestAnimationFrame(step);
    };
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) inertia.current = requestAnimationFrame(step);
  };

  // 끌어서 넘긴 경우에는 손을 뗄 때 링크가 눌리지 않게 막는다
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  };

  return (
    <nav aria-label="카테고리" className="relative">
      <div
        ref={ref}
        onScroll={wrap}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onMouseEnter={() => (hover.current = true)}
        onMouseLeave={() => {
          hover.current = false;
          touched();
        }}
        onFocus={() => (hover.current = true)}
        onBlur={() => (hover.current = false)}
        onWheel={touched}
        onTouchStart={touched}
        onTouchMove={touched}
        className={`flex overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          grabbing ? "cursor-grabbing select-none" : "cursor-grab"
        }`}
      >
        {Array.from({ length: COPIES }).flatMap((_, copy) =>
          CATEGORIES.map((c) => {
            const real = copy === 1; // 가운데 묶음만 키보드·스크린리더에 노출
            return (
              <Link
                key={`${copy}-${c.name}`}
                href={`/groups?cat=${encodeURIComponent(c.name)}`}
                draggable={false}
                tabIndex={real ? undefined : -1}
                aria-hidden={real ? undefined : true}
                className="group flex w-[84px] shrink-0 flex-col items-center gap-2 py-1 md:w-[96px]"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-paper ring-1 ring-line transition group-hover:ring-ink md:h-16 md:w-16">
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="#111" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={c.d} />
                  </svg>
                </span>
                <span className="text-[13px] font-medium text-[#4A4A4A] group-hover:text-ink">{c.name}</span>
              </Link>
            );
          })
        )}
      </div>
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-white to-transparent" />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent" />
    </nav>
  );
}
