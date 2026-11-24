"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { api, ApiProduct, Seller } from "@/lib/api";
import { chainBuyAbi } from "@/lib/contracts.generated";
import { CHAINBUY_ADDRESS } from "@/lib/config";
import { createdGroupId, deadlineIn } from "@/lib/createdGroup";
import { STATUS_LABEL, shortAddr, toToken, won } from "@/lib/groups";
import { useGroups } from "@/lib/hooks";
import { useTx } from "@/lib/useTx";
import { CATEGORIES } from "@/lib/categories";
import { useAuth } from "@/components/AuthProvider";
import { LoginGate } from "@/components/LoginGate";
import { Field, Notice } from "@/components/Field";
import { ProductThumb } from "@/components/ProductThumb";

export default function SellerPage() {
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-8 px-4 py-10 md:px-6">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">판매자센터</h1>
        <p className="mt-2 text-[15px] text-muted">상품을 직접 등록하고 공구를 열어요. 결제 대금은 결제 즉시 등록한 지갑으로 들어와요.</p>
      </div>
      <LoginGate what="판매자센터">
        <SellerHome />
      </LoginGate>
    </div>
  );
}

function SellerHome() {
  const { session } = useAuth();
  const token = session!.token;
  const me = useQuery({
    queryKey: ["seller-me", token],
    queryFn: () => api<Seller | null>("/sellers/me", { token }),
  });

  if (me.isLoading) return <p className="text-muted">불러오는 중…</p>;
  if (me.error) return <Notice tone="error">{(me.error as Error).message}</Notice>;

  const s = me.data;
  if (!s || s.status === "rejected") return <ApplyForm rejected={s?.rejectReason ?? null} onDone={() => me.refetch()} />;
  if (s.status === "pending")
    return (
      <Notice>
        <strong>입점 신청을 검토하고 있어요.</strong>
        <br />
        {s.name} · 정산 지갑 {shortAddr(s.address)} · 담당자가 승인하면 컨트랙트에 판매자 지갑이 등록되고 상품을 올릴 수 있어요.
      </Notice>
    );
  return <ApprovedSeller seller={s} />;
}

function ApplyForm({ rejected, onDone }: { rejected: string | null; onDone: () => void }) {
  const { session } = useAuth();
  const { address } = useAccount();
  const [form, setForm] = useState({ name: "", bizNo: "", contact: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/sellers", { token: session!.token, body: form });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-2xl border border-line p-6 md:p-8">
      <h2 className="section-title">입점 신청</h2>
      {rejected && <Notice tone="error">이전 신청이 반려됐어요: {rejected}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="상호">
          <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="오늘의 커피" />
        </Field>
        <Field label="사업자등록번호" hint="000-00-00000 (데모에서는 형식만 확인해요)">
          <input className="input" required value={form.bizNo} onChange={(e) => setForm({ ...form, bizNo: e.target.value })} placeholder="123-45-67890" />
        </Field>
        <Field label="연락처">
          <input className="input" required value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="010-0000-0000 또는 이메일" />
        </Field>
        <Field label="정산 지갑" hint="지금 연결한 지갑으로 결제 대금이 들어와요">
          <input className="input bg-paper font-mono text-sm" readOnly value={address ?? ""} />
        </Field>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" className="btn-primary h-12 self-start px-6" disabled={busy}>
        {busy ? "신청하는 중…" : "입점 신청하기"}
      </button>
    </form>
  );
}

function ApprovedSeller({ seller }: { seller: Seller }) {
  const { session } = useAuth();
  const token = session!.token;
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ["my-products", token], queryFn: () => api<ApiProduct[]>("/products/mine", { token }) });
  const { groups } = useGroups();
  const myGroups = groups.filter((g) => g.isListed && g.partyId === seller.sellerIdHash).reverse();

  return (
    <div className="flex flex-col gap-10">
      <Notice tone="ok">
        <strong>{seller.name}</strong> · 승인된 판매자 · 정산 지갑 {shortAddr(seller.address)}
      </Notice>

      <ProductForm
        onDone={() => {
          void products.refetch();
          void qc.invalidateQueries({ queryKey: ["products"] });
        }}
      />

      <section className="flex flex-col gap-4">
        <h2 className="section-title">내 상품</h2>
        {products.data?.length ? (
          <ul className="flex flex-col gap-3">
            {products.data.map((p) => (
              <ProductRow key={p.id} p={p} seller={seller} />
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-muted">아직 등록한 상품이 없어요.</p>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="section-title">내 공구</h2>
        {myGroups.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line px-5">
            {myGroups.map((g) => (
              <li key={String(g.id)}>
                <Link href={`/groups/${g.id}`} className="flex flex-wrap items-center gap-4 py-4">
                  <span className="min-w-[200px] flex-1 font-medium">{g.product?.name ?? `공구 #${g.id}`}</span>
                  <span className="text-sm text-muted">
                    {g.totalQty}/{g.targetQty}개 · {won(g.maxPrice)}
                  </span>
                  <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-sm font-bold">{STATUS_LABEL[g.statusName]}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-muted">아직 연 공구가 없어요. 위 상품에서 공구를 열어 보세요.</p>
        )}
      </section>
    </div>
  );
}

const emptyProduct = { name: "", category: CATEGORIES[0].name, option: "", originalPrice: 0, price: 0, description: "" };

function ProductForm({ onDone }: { onDone: () => void }) {
  const { session } = useAuth();
  const [f, setF] = useState(emptyProduct);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/products", { token: session!.token, body: f });
      setF(emptyProduct);
      setMsg({ tone: "ok", text: "상품을 등록했어요. 아래 '내 상품'에서 공구를 열 수 있어요." });
      onDone();
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-2xl border border-line p-6 md:p-8">
      <h2 className="section-title">상품 등록</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="상품명">
          <input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="콜롬비아 수프리모 원두 1kg" />
        </Field>
        <Field label="카테고리">
          <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="옵션">
          <input className="input" required value={f.option} onChange={(e) => setF({ ...f, option: e.target.value })} placeholder="홀빈 · 1kg" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="정가 (원)">
            <input className="input" type="number" min={1} required value={f.originalPrice || ""} onChange={(e) => setF({ ...f, originalPrice: Number(e.target.value) })} />
          </Field>
          <Field label="공구가 (원)">
            <input className="input" type="number" min={1} required value={f.price || ""} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} />
          </Field>
        </div>
      </div>
      <Field label="상품 설명">
        <textarea className="input h-24 py-3" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="원산지, 배송 안내 등" />
      </Field>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <button type="submit" className="btn-dark h-12 self-start px-6" disabled={busy}>
        {busy ? "등록하는 중…" : "상품 등록"}
      </button>
    </form>
  );
}

function ProductRow({ p, seller }: { p: ApiProduct; seller: Seller }) {
  const [open, setOpen] = useState(false);
  const tx = useTx();
  const [o, setO] = useState({ price: p.price, target: 20, perUser: 2, days: 3 });
  const [created, setCreated] = useState<bigint | null>(null);
  const invalid = o.price <= 0 || o.target < 2 || o.perUser < 1 || o.perUser > o.target || o.days < 1;

  const openGroup = async () => {
    try {
      const receipt = await tx.send("공구 여는 중", {
        address: CHAINBUY_ADDRESS!,
        abi: chainBuyAbi,
        functionName: "createListedGroup",
        args: [
          seller.sellerIdHash,
          { productHash: p.productHash, maxPrice: toToken(o.price), targetQty: o.target, maxPerUser: o.perUser, deadline: deadlineIn(o.days) },
        ],
      });
      setCreated(createdGroupId(receipt));
      setOpen(false);
    } catch {
      /* tx.error 표시 */
    }
  };

  return (
    <li className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center gap-4">
        <ProductThumb product={p} className="h-14 w-14 shrink-0 rounded-lg" />
        <div className="min-w-[200px] flex-1">
          <strong className="block font-medium">{p.name}</strong>
          <span className="text-sm text-muted">
            {p.category} · {p.option} · 정가 {p.originalPrice.toLocaleString()}원 → 공구가 {p.price.toLocaleString()}원
          </span>
        </div>
        <button type="button" className="btn-line" onClick={() => setOpen(!open)}>
          {open ? "닫기" : "공구 열기"}
        </button>
      </div>
      {created && (
        <div className="mt-3">
          <Notice tone="ok">
            공구를 열었어요.{" "}
            <Link href={`/groups/${created}`} className="font-bold underline">
              공구 #{String(created)} 보기
            </Link>
          </Notice>
        </div>
      )}
      {open && (
        <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="최대 가격 (원)" hint="실제 가격이 낮으면 차액 환불">
              <input className="input" type="number" min={1} value={o.price} onChange={(e) => setO({ ...o, price: Number(e.target.value) })} />
            </Field>
            <Field label="목표 수량">
              <input className="input" type="number" min={2} value={o.target} onChange={(e) => setO({ ...o, target: Number(e.target.value) })} />
            </Field>
            <Field label="1인 최대">
              <input className="input" type="number" min={1} value={o.perUser} onChange={(e) => setO({ ...o, perUser: Number(e.target.value) })} />
            </Field>
            <Field label="모집 기간 (일)">
              <input className="input" type="number" min={1} max={30} value={o.days} onChange={(e) => setO({ ...o, days: Number(e.target.value) })} />
            </Field>
          </div>
          <p className="text-sm text-muted">공구를 열면 조건이 체인에 고정돼요. 플랫폼 수수료 5%는 판매 대금에서 빠져요.</p>
          {tx.error && <Notice tone="error">{tx.error}</Notice>}
          <button type="button" className="btn-primary h-12 self-start px-6" disabled={invalid || !!tx.pending} onClick={openGroup}>
            {tx.pending ?? "이 조건으로 공구 열기"}
          </button>
        </div>
      )}
    </li>
  );
}
