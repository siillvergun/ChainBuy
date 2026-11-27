"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useDisconnect } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { useMe } from "@/lib/hooks";
import { useSmartAccount } from "@/lib/smartAccount";
import { api, MyInfluencer, Proposal, Seller, STATUS_KO } from "@/lib/api";
import { ParticipationRow, SummaryStats, useParticipations } from "@/components/Participations";
import { ChainNotice, Empty } from "@/components/States";
import { useAuth } from "@/components/AuthProvider";

/** 마이페이지: 계정 · 내 역할 · 참여 내역 · 공구 제안 */
export default function MyPage() {
  const [mounted, setMounted] = useState(false);
  const { session, expired } = useAuth();
  useEffect(() => setMounted(true), []);

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-10 px-4 py-10 md:px-6">
      <h1 className="text-[28px] font-extrabold tracking-tight">마이페이지</h1>
      {!mounted ? null : !session ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-paper p-6">
          <strong className="text-lg">{expired ? "로그인이 만료됐어요. 다시 로그인해 주세요" : "로그인하면 참여 내역과 내 정보를 볼 수 있어요"}</strong>
          <Link href="/login?next=/my" className="btn-primary h-12 px-6">
            {expired ? "다시 로그인" : "지갑으로 로그인"}
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

/** 판매자 · 인플루언서 · 담당자: 지금 상태와, 다음에 할 일 버튼 */
function Roles() {
  const { session } = useAuth();
  const token = session!.token;
  const seller = useQuery({ queryKey: ["seller-me", token], queryFn: () => api<Seller | null>("/sellers/me", { token }) });
  const inf = useQuery({ queryKey: ["influencer-me", token], queryFn: () => api<MyInfluencer | null>("/influencers/me", { token }) });

  const s = seller.data;
  const sellerCard = !s
    ? { status: "아직 판매자가 아니에요", desc: "내 상품을 등록하고 직접 공구를 열 수 있어요", cta: "판매자 입점 신청하기", active: false }
    : s.status === "approved"
      ? { status: `${s.name} · 승인됨`, desc: "상품 등록, 공구 열기, 협찬 인플루언서 태그", cta: "판매자센터", active: true }
      : s.status === "pending"
        ? { status: `${s.name} · 검토 중`, desc: "담당자가 확인하면 상품을 올릴 수 있어요", cta: "신청 내용 보기", active: false }
        : { status: "반려됨", desc: s.rejectReason ?? "", cta: "다시 신청하기", active: false };

  const i = inf.data;
  const pendingTags = i?.tags.filter((t) => t.status === "pending").length ?? 0;
  const infCard = !i
    ? { status: "아직 인플루언서가 아니에요", desc: "SNS 계정을 인증하면 판매자가 공구에 협찬으로 태그할 수 있어요", cta: "인플루언서 인증하기", active: false }
    : !i.verified
      ? { status: `@${i.handle} · 인증 전`, desc: "YouTube·Instagram·Threads·TikTok 중 하나를 연결해 주세요", cta: "SNS 계정 인증하기", active: false }
      : {
          status: `@${i.handle} · 인증됨`,
          desc: pendingTags ? `수락 대기 중인 협찬 태그 ${pendingTags}건` : i.accounts.map((a) => a.label).join(" · "),
          cta: pendingTags ? "태그 확인하기" : "인플루언서 관리",
          active: true,
        };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="section-title">판매자 · 인플루언서</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <RoleCard href="/seller" title="판매자" {...sellerCard} />
        <RoleCard href="/influencer" title="인플루언서" {...infCard} />
      </div>
      {session!.isReviewer && (
        <Link href="/admin" className="btn-line self-start">
          공구 담당자 화면 (결제 승인·공구 제안 검토)
        </Link>
      )}
      {session!.isSellerManager && (
        <Link href="/admin" className="btn-line self-start">
          입점 담당자 화면 (판매자 입점 신청 검토)
        </Link>
      )}
    </section>
  );
}

function RoleCard({ href, title, status, desc, cta, active }: { href: string; title: string; status: string; desc: string; cta: string; active: boolean }) {
  return (
    <div className={`flex flex-col gap-3 rounded-xl border p-5 ${active ? "border-safe" : "border-line"}`}>
      <div>
        <span className="text-xs font-bold text-muted">{title}</span>
        <strong className={`mt-0.5 block text-base ${active ? "text-safe" : ""}`}>{status}</strong>
        {desc && <p className="mt-1 text-sm text-muted">{desc}</p>}
      </div>
      <Link href={href} className={`${active ? "btn-line" : "btn-dark"} self-start`}>
        {cta}
      </Link>
    </div>
  );
}

/** 참여 요약 + 최근 3건. 전체 목록은 장바구니에서 */
function Participations() {
  const account = useSmartAccount(); // 참여 기록은 스마트 지갑 주소에 남는다
  const { rows, holding, refundable, toConfirm, error } = useParticipations(account);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <h2 className="section-title">참여 내역</h2>
        <Link href="/cart" className="text-sm font-bold text-[#4A4A4A] hover:text-ink">
          장바구니에서 전체 보기 ›
        </Link>
      </div>
      <ChainNotice error={error} />
      <SummaryStats holding={holding} toConfirm={toConfirm} refundable={refundable} />
      {rows.length === 0 ? (
        <Empty>
          아직 참여한 공구가 없어요.{" "}
          <Link href="/groups" className="font-bold text-accent">
            공구 둘러보기
          </Link>
        </Empty>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-white px-5">
          {rows.slice(0, 3).map((x) => (
            <ParticipationRow key={String(x.g.id)} x={x} />
          ))}
        </ul>
      )}
    </section>
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
