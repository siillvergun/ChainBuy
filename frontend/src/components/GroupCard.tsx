import Link from "next/link";
import { GroupView, discountRate, remaining, won, STATUS_LABEL } from "@/lib/groups";
import { ProductThumb } from "./ProductThumb";

export function GroupCard({ g, rank }: { g: GroupView; rank?: number }) {
  const rate = discountRate(g.product, g.maxPrice);
  const pct = Math.min(100, Math.round((g.totalQty / g.targetQty) * 100));
  const open = g.statusName === "OPEN";

  return (
    <Link href={`/groups/${g.id}`} className="group block">
      <div className="relative overflow-hidden rounded-lg">
        <ProductThumb product={g.product} className="aspect-square w-full transition group-hover:scale-[1.02]" />
        {rank !== undefined && (
          <span className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-br-lg bg-ink text-sm font-extrabold text-white">
            {rank}
          </span>
        )}
        {!open && (
          <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1.5 text-center text-xs font-bold text-white">
            {STATUS_LABEL[g.statusName]}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-1">
        <span className="text-xs font-bold text-muted">{g.isListed ? "판매자 특가" : "추천 공구 · 이용료 5%"}</span>
        <strong className="line-clamp-2 text-[15px] font-medium leading-snug text-ink">
          {g.product?.name ?? `공구 #${g.id}`}
        </strong>
        <div className="flex items-baseline gap-1.5">
          {rate > 0 && <span className="text-lg font-extrabold text-accent">{rate}%</span>}
          <span className="text-lg font-extrabold">{won(g.maxPrice)}</span>
        </div>
        {g.product && <span className="text-xs text-muted line-through">{g.product.originalPrice.toLocaleString()}원</span>}
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between text-xs">
          <span className="font-bold text-accent">
            {g.totalQty}/{g.targetQty}개 모임
          </span>
          {open && <span className="text-muted">{remaining(g.deadline)}</span>}
        </div>
      </div>
    </Link>
  );
}
