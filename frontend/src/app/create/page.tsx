"use client";

import Link from "next/link";
import { useState } from "react";
import { api, Proposal } from "@/lib/api";
import { CATEGORIES } from "@/lib/categories";
import { useAuth } from "@/components/AuthProvider";
import { LoginGate } from "@/components/LoginGate";
import { Field, Notice } from "@/components/Field";

const ALLOWED = ["coupang.com", "smartstore.naver.com", "11st.co.kr"];

/**
 * 공동구매 열기
 * - 판매자: 판매자센터에서 내 상품을 등록하고 공구를 연다
 * - 일반 사용자: 대형 쇼핑몰 상품을 링크로 제안 → 담당자 확인 후 공구가 열린다
 */
export default function CreatePage() {
  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-8 px-4 py-10 md:px-6">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">공동구매 열기</h1>
        <p className="mt-2 text-[15px] text-muted">조건은 공구가 열릴 때 체인에 기록되고, 이후에는 누구도 바꿀 수 없어요.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/seller" className="rounded-xl border-2 border-line p-5 hover:border-ink">
          <span className="text-xs font-bold text-accent">판매자</span>
          <strong className="mt-1 block text-lg">내 상품으로 공구 열기 →</strong>
          <span className="mt-1 block text-sm text-[#4A4A4A]">판매자센터에서 입점 신청·상품 등록·공구 열기 · 결제 즉시 정산</span>
        </Link>
        <div className="rounded-xl border-2 border-accent bg-accent-tint p-5">
          <span className="text-xs font-bold text-accent">일반 사용자</span>
          <strong className="mt-1 block text-lg">대형 쇼핑몰 상품 제안</strong>
          <span className="mt-1 block text-sm text-[#4A4A4A]">써 보고 좋았던 상품을 링크로 제안 · 담당자 확인 후 열림</span>
        </div>
      </div>

      <LoginGate what="공구 제안">
        <ProposalForm />
      </LoginGate>
    </div>
  );
}

const empty = {
  url: "",
  name: "",
  category: CATEGORIES[0].name,
  option: "",
  currentPrice: 0,
  maxPrice: 0,
  targetQty: 10,
  maxPerUser: 2,
  days: 5,
  reason: "",
};

function ProposalForm() {
  const { session } = useAuth();
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Proposal | null>(null);

  let host = "";
  try {
    host = f.url ? new URL(f.url).hostname.replace(/^www\./, "") : "";
  } catch {
    host = "";
  }
  const allowed = f.url.startsWith("https://") && ALLOWED.some((d) => host === d || host.endsWith(`.${d}`));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone(await api<Proposal>("/proposals", { token: session!.token, body: f }));
      setF(empty);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <Notice tone="ok">
        <strong>제안을 접수했어요.</strong> 담당자가 링크와 조건을 확인하면 공구가 열려요.{" "}
        <Link href="/my" className="font-bold underline">
          내 제안 보기
        </Link>
        <br />
        <button type="button" className="mt-2 text-sm font-bold underline" onClick={() => setDone(null)}>
          다른 상품 제안하기
        </button>
      </Notice>
    );

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 rounded-2xl border border-line p-6 md:p-8">
      <Field label="상품 링크" hint={`허용 쇼핑몰: ${ALLOWED.join(", ")} · https 링크만, 단축 URL 불가`}>
        <input className="input" type="url" required placeholder="https://www.coupang.com/vp/products/..." value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
      </Field>
      {f.url && (
        <Notice tone={allowed ? "ok" : "error"}>
          {allowed ? `${host} — 허용된 쇼핑몰이에요` : "허용되지 않은 링크예요. 허용 쇼핑몰의 https 링크만 제안할 수 있어요."}
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="상품명">
          <input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="대용량 세탁 세제 4L 4개" />
        </Field>
        <Field label="카테고리">
          <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="옵션" hint="담당자·AI가 이 옵션으로 결제해요">
          <input className="input" required value={f.option} onChange={(e) => setF({ ...f, option: e.target.value })} placeholder="무향 · 4개" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="현재 가격 (원)">
            <input className="input" type="number" min={1} required value={f.currentPrice || ""} onChange={(e) => setF({ ...f, currentPrice: Number(e.target.value) })} />
          </Field>
          <Field label="최대 가격 (원)" hint="이보다 오르면 전액 환불">
            <input className="input" type="number" min={1} required value={f.maxPrice || ""} onChange={(e) => setF({ ...f, maxPrice: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="목표 수량">
          <input className="input" type="number" min={2} value={f.targetQty} onChange={(e) => setF({ ...f, targetQty: Number(e.target.value) })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="1인 최대">
            <input className="input" type="number" min={1} value={f.maxPerUser} onChange={(e) => setF({ ...f, maxPerUser: Number(e.target.value) })} />
          </Field>
          <Field label="모집 기간 (일)">
            <input className="input" type="number" min={1} max={30} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} />
          </Field>
        </div>
      </div>
      <Field label="추천 이유 (선택)">
        <textarea className="input h-24 py-3" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="써 보니 좋았던 점을 적어 주세요" />
      </Field>

      <Notice>
        • 결제는 그 쇼핑몰에서만 쓸 수 있는 일회용 카드로 이루어져요. 제안한 사람에게 돈이 가지 않아요.
        <br />• 이용료 5%가 예치금에 포함되고, 상품 화면에 표시돼요.
      </Notice>
      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" className="btn-primary h-[52px] text-base" disabled={busy || !allowed}>
        {busy ? "제안하는 중…" : "공구 제안하기"}
      </button>
    </form>
  );
}
