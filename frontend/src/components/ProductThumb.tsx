import { Product } from "@/lib/groups";
import { categoryIcon } from "@/lib/categories";

/** 상품 이미지 자리. 실제 이미지가 생기기 전까지 카테고리 아이콘 + 색 배경으로 표시한다. */
export function ProductThumb({ product, className = "" }: { product?: Product; className?: string }) {
  const d = categoryIcon(product?.category);
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
