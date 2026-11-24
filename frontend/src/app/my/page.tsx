"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useDisconnect, useReadContracts } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { useGroups, useMe } from "@/lib/hooks";
import { chainBuyAbi } from "@/lib/contracts.generated";
import { CHAINBUY_ADDRESS } from "@/lib/config";
import { STATUS_LABEL, won } from "@/lib/groups";
import { api, MyInfluencer, Proposal, Seller, STATUS_KO } from "@/lib/api";
import { ProductThumb } from "@/components/ProductThumb";
import { ChainNotice, Empty } from "@/components/States";
import { useAuth } from "@/components/AuthProvider";

type P = { qty: number; deposited: bigint; refunded: boolean; receipt: number };

/** 마이페이지: 계정 · 내 역할 · 참여 내역 · 공구 제안 */
export default function MyPage() {
  const [mounted, setMounted] = useState(false);
  const { session } = useAuth();
  useEffect(() => setMounted(true), []);

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-10 px-4 py-10 md:px-6">
      <h1 className="text-[28px] font-extrabold tracking-tight">마이페이지</h1>
      {!mounted ? null : !session ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-paper p-6">
          <strong className="text-lg">로그인하면 참여 내역과 내 정보를 볼 수 있어요</strong>
          <Link href="/login?next=/my" className="btn-primary h-12 px-6">
            지갑으로 로그인
          </Link>
        </div>
      ) : (
        <>
          <AccountCard />
          <Roles />
          <Participations />
          <MyProposals />
        </>
      )}
    </div>
  );
}

function AccountCard() {
  const { session, logout } = useAuth();
  const { disconnect } = useDisconnect();
  const me = useMe(session!.token);
  const s = me.data?.shipping;

  return (
    <section className="flex flex-wrap items-start gap-6 rounded-2xl border border-line p-6 md:p-8">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent-tint text-2xl font-extrabold text-accent">
        {(me.data?.nickname || "?").slice(0, 1)}
      </div>
      <div className="min-w-[240px] flex-1">
        <strong className="text-xl">{me.data?.nickname || "닉네임 없음"}</strong>
        <p className="mt-1 break-all font-mono text-[13px] text-muted">{session!.address}</p>
        <dl className="mt-4 grid grid-cols-[72px_1fr] gap-y-1.5 text-[15px]">
          <dt className="text-muted">연락처</dt>
          <dd>{me.data?.contact || "-"}</dd>
          <dt className="text-muted">배송지</dt>
          <dd>
            {s ? (
              <>
                {s.name} · {s.phone}
                <br />({s.zip}) {s.address1} {s.address2}
              </>
            ) : (
              <span className="font-bold text-accent">등록 전 — 공구에 참여하려면 필요해요</span>
            )}
          </dd>
        </dl>
      </div>
      <div className="flex gap-2">
        <Link href="/my/profile" className="btn-dark">
          프로필 변경
        </Link>
        <button
          type="button"
          className="btn-line"
          onClick={() => {
            logout();
            disconnect();
          }}
        >
          로그아웃
        </button>
      </div>
    </section>
  );
}

/** 판매자 · 인플루언서 · 담당자 상태와 바로가기 */
function Roles() {
  const { session } = useAuth();
  const token = session!.token;
  const seller = useQuery({ queryKey: ["seller-me", token], queryFn: () => api<Seller | null>("/sellers/me", { token }) });
  const inf = useQuery({ queryKey: ["influencer-me", token], queryFn: () => api<MyInfluencer | null>("/influencers/me", { token }) });

  const sellerText = !seller.data
    ? "입점 신청 전"
    : seller.data.status === "approved"
      ? `${seller.data.name} · 승인됨`
      : seller.data.status === "pending"
        ? `${seller.data.name} · 검토 중`
        : "반려됨 · 다시 신청 가능";
  const pendingTags = inf.data?.tags.filter((t) => t.status === "pending").length ?? 0;
  const infText = !inf.data ? "프로필 없음" : `@${inf.data.handle} · ${inf.data.verified ? "SNS 인증됨" : "인증 전"}${pendingTags ? ` · 수락 대기 ${pendingTags}건` : ""}`;

  return (
    <section className="grid gap-3 sm:grid-cols-3">
      <RoleCard href="/seller" title="판매자센터" text={sellerText} active={seller.data?.status === "approved"} />
      <RoleCard href="/influencer" title="인플루언서" text={infText} active={!!inf.data?.verified} />
      {session!.isReviewer ? (
        <RoleCard href="/admin" title="담당자" text="입점 신청·공구 제안 검토" active />
      ) : (
        <RoleCard href="/create" title="공구 제안" text="써 보고 좋았던 상품을 링크로 제안" />
      )}
    </section>
  );
}

function RoleCard({ href, title, text, active }: { href: string; title: string; text: string; active?: boolean }) {
  return (
    <Link href={href} className={`flex flex-col gap-1 rounded-xl border p-5 hover:border-ink ${active ? "border-safe" : "border-line"}`}>
      <strong className="text-base">{title} ›</strong>
      <span className={`text-sm ${active ? "font-bold text-safe" : "text-muted"}`}>{text}</span>
    </Link>
  );
}

function Participations() {
  const { address } = useAccount();
  const { session } = useAuth();
  const who = (address ?? session!.address) as `0x${string}`;
  const { groups, error } = useGroups();
  const cb = { address: CHAINBUY_ADDRESS, abi: chainBuyAbi } as const;

  const reads = useReadContracts({
    contracts: groups.flatMap((g) => [
      { ...cb, functionName: "getParticipant", args: [g.id, who] } as const,
      { ...cb, functionName: "refundableAmount", args: [g.id, who] } as const,
    ]),
    query: { enabled: groups.length > 0 },
  });

  const mine = useMemo(() => {
    if (!reads.data) return [];
    return groups
      .map((g, i) => ({ g, p: reads.data[i * 2]?.result as P | undefined, refundable: (reads.data[i * 2 + 1]?.result as bigint | undefined) ?? 0n }))
      .filter((x) => x.p && x.p.qty > 0)
      .reverse();
  }, [groups, reads.data]);

  const holding = mine.filter((x) => ["OPEN", "PENDING_CHECK", "APPROVED"].includes(x.g.statusName)).reduce((s, x) => s + x.p!.deposited, 0n);
  const refundable = mine.reduce((s, x) => s + x.refundable, 0n);
  const toConfirm = mine.filter((x) => x.g.statusName === "SHIPPED" && x.p!.receipt === 0).length;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="section-title">참여 내역</h2>
      <ChainNotice error={error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="컨트랙트에 예치 중" value={won(holding)} />
        <Stat label="수령 확인 대기" value={`${toConfirm}건`} accent={toConfirm > 0} />
        <Stat label="지금 환불 받을 수 있는 금액" value={won(refundable)} accent={refundable > 0n} />
      </div>
      {mine.length === 0 ? (
        <Empty>
          아직 참여한 공구가 없어요.{" "}
          <Link href="/groups" className="font-bold text-accent">
            공구 둘러보기
          </Link>
        </Empty>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-white px-5">
          {mine.map(({ g, p, refundable }) => (
            <li key={String(g.id)}>
              <Link href={`/groups/${g.id}`} className="flex flex-wrap items-center gap-4 py-4">
                <ProductThumb product={g.product} className="h-14 w-14 shrink-0 rounded-lg" />
                <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
                  <strong className="text-[15px] font-medium">{g.product?.name ?? `공구 #${g.id}`}</strong>
                  <span className="text-sm text-muted">
                    {p!.qty}개 · {won(p!.deposited)} 예치{p!.refunded && " · 환불 받음"}
                  </span>
                </div>
                {refundable > 0n && <span className="text-sm font-bold text-accent">{won(refundable)} 환불 가능</span>}
                {g.statusName === "SHIPPED" && p!.receipt === 0 && <span className="text-sm font-bold text-accent">수령 확인 필요</span>}
                <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-sm font-bold text-[#374151]">{STATUS_LABEL[g.statusName]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-1.5 rounded-xl border p-5 ${accent ? "border-accent" : "border-line"}`}>
      <span className="text-sm text-muted">{label}</span>
      <strong className="text-2xl font-extrabold">{value}</strong>
    </div>
  );
}

/** 내가 제안한 외부 상품 공구 */
function MyProposals() {
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ["my-proposals", session?.token],
    queryFn: () => api<Proposal[]>("/proposals/mine", { token: session!.token }),
    enabled: !!session,
  });
  if (!q.data?.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="section-title">공구 제안</h2>
      <ul className="divide-y divide-line rounded-xl border border-line px-5">
        {q.data.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-4 py-4">
            <div className="min-w-[200px] flex-1">
              <strong className="text-[15px] font-medium">{p.name}</strong>
              <p className="text-sm text-muted">
                최대 {p.maxPrice.toLocaleString()}원 · 목표 {p.targetQty}개{p.rejectReason && ` · 거절 사유: ${p.rejectReason}`}
              </p>
            </div>
            {p.groupId && (
              <Link href={`/groups/${p.groupId}`} className="text-sm font-bold text-accent">
                공구 #{p.groupId} 보기
              </Link>
            )}
            <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-sm font-bold text-[#374151]">{STATUS_KO[p.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
