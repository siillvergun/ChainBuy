"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/categories";

/**
 * 메인 카테고리 줄. 가로로 넘치면
 * - 마우스: 잡고 끌어서 넘긴다 (끌었을 때는 링크 클릭이 되지 않음)
 * - 터치·트랙패드: 기본 가로 스크롤
 * - 양 끝 화살표 버튼으로 한 화면씩 이동
 */
export function CategoryRail() {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ down: false, startX: 0, startLeft: 0, moved: false });
  const [grabbing, setGrabbing] = useState(false);
  const [edge, setEdge] = useState({ start: true, end: false });

  const updateEdge = () => {
    const el = ref.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  };

  useEffect(() => {
    updateEdge();
    window.addEventListener("resize", updateEdge);
    return () => window.removeEventListener("resize", updateEdge);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag.current = { down: true, startX: e.clientX, startLeft: ref.current!.scrollLeft, moved: false };
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
    if (d.moved) ref.current!.scrollLeft = d.startLeft - dx;
  };
  const endDrag = () => {
    drag.current.down = false;
    setGrabbing(false);
  };
  // 끌어서 넘긴 경우에는 손을 뗄 때 링크가 눌리지 않게 막는다
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  };

  const page = (dir: 1 | -1) => {
    const el = ref.current!;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <nav aria-label="카테고리" className="relative">
      <div
        ref={ref}
        onScroll={updateEdge}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        className={`flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          grabbing ? "cursor-grabbing select-none" : "cursor-grab"
        } ${grabbing ? "" : "scroll-smooth"}`}
      >
        {CATEGORIES.map((c) => (
          <Link
            key={c.name}
            href={`/groups?cat=${encodeURIComponent(c.name)}`}
            draggable={false}
            className="group flex w-[76px] shrink-0 flex-col items-center gap-2 py-1 md:w-[88px]"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-paper ring-1 ring-line transition group-hover:ring-ink md:h-16 md:w-16">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="#111" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={c.d} />
              </svg>
            </span>
            <span className="text-[13px] font-medium text-[#4A4A4A] group-hover:text-ink">{c.name}</span>
          </Link>
        ))}
      </div>

      {!edge.start && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-white to-transparent" />
          <button
            type="button"
            aria-label="카테고리 이전"
            onClick={() => page(-1)}
            className="absolute left-0 top-[22px] hidden h-9 w-9 items-center justify-center rounded-full border border-line bg-white shadow-sm hover:border-ink md:flex"
          >
            ‹
          </button>
        </>
      )}
      {!edge.end && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-white to-transparent" />
          <button
            type="button"
            aria-label="카테고리 다음"
            onClick={() => page(1)}
            className="absolute right-0 top-[22px] hidden h-9 w-9 items-center justify-center rounded-full border border-line bg-white shadow-sm hover:border-ink md:flex"
          >
            ›
          </button>
        </>
      )}
    </nav>
  );
}
