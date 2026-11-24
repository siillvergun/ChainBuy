import { formatUnits, keccak256, parseUnits, toBytes } from "viem";
import catalog from "./catalog.json";
import { TOKEN_DECIMALS } from "./config";

/** 화면에 쓰는 상품 정보 (백엔드 /products, 없으면 catalog.json mock) */
export type Product = {
  id: string;
  name: string;
  category: string;
  option: string;
  originalPrice: number;
  price: number;
  tint: string;
  description?: string;
  url?: string | null;
  sellerName?: string | null;
};

export const STATUS = [
  "OPEN",
  "FAILED",
  "PENDING_CHECK",
  "CANCELLED",
  "APPROVED",
  "PAID",
  "SHIPPED",
  "COMPLETED",
] as const;
export type StatusName = (typeof STATUS)[number];

export const STATUS_LABEL: Record<StatusName, string> = {
  OPEN: "모집 중",
  FAILED: "목표 미달 · 환불",
  PENDING_CHECK: "상품 확인 중",
  CANCELLED: "취소 · 환불",
  APPROVED: "결제 승인됨",
  PAID: "결제 완료",
  SHIPPED: "배송 완료",
  COMPLETED: "거래 종료",
};

/** 온체인 getGroup 결과 (viem이 돌려주는 구조체) */
export type OnchainGroup = {
  kind: number;
  status: number;
  creator: `0x${string}`;
  payee: `0x${string}`;
  partyId: `0x${string}`;
  feeBps: number;
  productHash: `0x${string}`;
  maxPrice: bigint;
  targetQty: number;
  maxPerUser: number;
  totalQty: number;
  settledQty: number;
  deadline: bigint;
  pendingSince: bigint;
  shippedAt: bigint;
  checkSubmitted: boolean;
  checkedPrice: bigint;
  checkHash: `0x${string}`;
  cardFunded: bigint;
  remainderReturned: boolean;
  actualGross: bigint;
  orderHash: `0x${string}`;
};

export type GroupView = OnchainGroup & {
  id: bigint;
  statusName: StatusName;
  isListed: boolean;
  product: Product | undefined;
};

/** 백엔드가 꺼져 있을 때 쓰는 mock 상품 목록 */
export const fallbackProducts = new Map<string, Product>(catalog.products.map((p) => [productHash(p.id), p]));

export function productHash(productId: string): `0x${string}` {
  return keccak256(toBytes(productId));
}

export function sellerIdHash(sellerId: string): `0x${string}` {
  return keccak256(toBytes(sellerId));
}

export function toView(id: bigint, g: OnchainGroup, products: Map<string, Product> = fallbackProducts): GroupView {
  return {
    ...g,
    id,
    statusName: STATUS[g.status],
    isListed: g.kind === 0,
    product: products.get(g.productHash) ?? fallbackProducts.get(g.productHash),
  };
}

export const products = catalog.products;
export const sellers = catalog.sellers;

export function won(amount: bigint | undefined): string {
  if (amount === undefined) return "-";
  const n = Number(formatUnits(amount, TOKEN_DECIMALS));
  return `${n.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}원`;
}

export function toToken(won: number | string): bigint {
  return parseUnits(String(won), TOKEN_DECIMALS);
}

/** 1개당 예치 금액 (컨트랙트 depositAmount와 같은 규칙) */
export function unitDeposit(g: Pick<OnchainGroup, "maxPrice" | "feeBps" | "kind">): bigint {
  if (g.kind === 0) return g.maxPrice;
  const fee = (g.maxPrice * BigInt(g.feeBps) + 9_999n) / 10_000n;
  return g.maxPrice + fee;
}

export function discountRate(p: Product | undefined, maxPrice: bigint): number {
  if (!p) return 0;
  const price = Number(formatUnits(maxPrice, TOKEN_DECIMALS));
  return Math.max(0, Math.round((1 - price / p.originalPrice) * 100));
}

export function remaining(deadline: bigint, now = Date.now()): string {
  const ms = Number(deadline) * 1000 - now;
  if (ms <= 0) return "마감";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (d > 0) return `${d}일 ${h}시간 남음`;
  if (h > 0) return `${h}시간 ${m}분 남음`;
  return `${m}분 남음`;
}

export function shortAddr(a?: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

export function isClosingToday(deadline: bigint, now = Date.now()): boolean {
  const ms = Number(deadline) * 1000 - now;
  return ms > 0 && ms < 86_400_000;
}
