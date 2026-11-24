import { Product } from "@/lib/groups";

/** 상품 이미지 자리. 실제 이미지가 생기기 전까지 카테고리 아이콘 + 색 배경으로 표시한다. */
const ICON: Record<string, string> = {
  디지털: "M7 3h10v18H7zM10 18h4",
  식품: "M5 11h14l-1.5 9h-11zM8 11V7a4 4 0 0 1 8 0v4",
  캠핑: "M3 20L12 4l9 16zM12 4v16",
  생활: "M4 20V8l8-5 8 5v12zM9 20v-6h6v6",
  육아: "M12 21c4 0 7-3 7-7 0-3-2-5-4-6l-1-4h-4l-1 4c-2 1-4 3-4 6 0 4 3 7 7 7z",
  주방: "M6 3v8a3 3 0 0 0 6 0V3M9 11v10M16 3c-2 2-2 6 0 8v10",
};

export function ProductThumb({ product, className = "" }: { product?: Product; className?: string }) {
  const d = ICON[product?.category ?? ""] ?? "M4 7h16v13H4zM9 7V4h6v3";
  return (
    <div
      className={`flex items-center justify-center ${className}`}
      style={{ background: product?.tint ?? "#F2F2F2" }}
      role="img"
      aria-label={product?.name ?? "상품 이미지"}
    >
      <svg viewBox="0 0 24 24" className="h-1/3 w-1/3" fill="none" stroke="#111" strokeOpacity="0.35" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round">
        <path d={d} />
      </svg>
    </div>
  );
}
