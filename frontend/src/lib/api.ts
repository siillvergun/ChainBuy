/** 백엔드(backend/api) 호출. 체인 밖 정보(상품·판매자·제안)만 다룬다. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "서버에 연결할 수 없어요. backend/api 가 실행 중인지 확인해 주세요.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `요청 실패 (${res.status})`);
  return data as T;
}

export type ApiProduct = {
  id: string;
  productHash: `0x${string}`;
  kind: "listed" | "external";
  seller: string | null;
  sellerName: string | null;
  name: string;
  category: string;
  option: string;
  originalPrice: number;
  price: number;
  description: string;
  url: string | null;
  tint: string;
};

export type Seller = {
  id: string;
  sellerIdHash: `0x${string}`;
  address: `0x${string}`;
  name: string;
  bizNo: string;
  contact: string;
  status: "pending" | "approved" | "rejected";
  rejectReason: string | null;
  createdAt: number;
};

export type Proposal = {
  id: string;
  proposer: `0x${string}`;
  productId: string;
  productHash: `0x${string}`;
  merchantId: string;
  merchantIdHash: `0x${string}`;
  name: string;
  category: string;
  option: string;
  url: string;
  currentPrice: number;
  maxPrice: number;
  targetQty: number;
  maxPerUser: number;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  rejectReason: string | null;
  groupId: number | null;
  createdAt: number;
};

export const STATUS_KO = { pending: "검토 중", approved: "승인", rejected: "거절" } as const;

export type LinkedAccount = { platform: string; label: string; username: string; url: string; verifiedAt: number };

export type Influencer = {
  address: `0x${string}`;
  handle: string;
  name: string;
  bio: string;
  verified: boolean;
  accounts: LinkedAccount[];
};

export type MyInfluencer = Influencer & {
  tags: { groupId: number; seller: string; status: "pending" | "accepted" | "rejected" | "removed"; createdAt: number }[];
};

export type PublicInfluencer = Influencer & { groupIds: number[] };

export type SponsorTag = { groupId: number; handle: string; name: string; platforms: string[] };

export type OAuthProvider = { platform: string; label: string; enabled: boolean };

export type Shipping = { name: string; phone: string; zip: string; address1: string; address2: string };

export type UserProfile = {
  address: `0x${string}`;
  nickname: string;
  contact: string;
  shipping: Shipping | null;
  /** 체인에 올리는 배송지 해시 (솔트 포함). 배송지가 없으면 null */
  recipientHash: `0x${string}` | null;
};
