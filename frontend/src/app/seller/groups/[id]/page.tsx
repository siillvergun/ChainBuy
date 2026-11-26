"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, Shipping } from "@/lib/api";
import { STATUS_LABEL, StatusName, won } from "@/lib/groups";
import { useGroup } from "@/lib/hooks";
import { useAuth } from "@/components/AuthProvider";
import { LoginGate } from "@/components/LoginGate";
import { Field, Notice } from "@/components/Field";

type Orders = {
  groupId: number;
  status: StatusName;
  totalQty: number;
  checkedPrice: string | number;
  orders: { address: string; nickname: string; qty: number; shipping: Shipping | null; shippingMatches: boolean }[];
  shipment: { trackingNo: string; carrier: string; createdAt: number; deliveryStatus: string | null } | null;
};

/** 판매자 주문 관리: 참여자 배송지 목록 · 운송장 등록 (PA-03, PA-04) */
export default function SellerGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-6 px-4 py-10 md:px-6">
      <p className="text-sm text-muted">
        <Link href="/seller" className="hover:text-ink">
          판매자센터
        </Link>{" "}
        › 주문 관리
      </p>
      <LoginGate what="주문 관리">
        <OrdersView id={Number(id)} />
      </LoginGate>
    </div>
  );
}

function OrdersView({ id }: { id: number }) {
  const { session } = useAuth();
  const token = session!.token;
  const { group } = useGroup(BigInt(id));
  const q = useQuery({ queryKey: ["seller-orders", id, token], queryFn: () => api<Orders>(`/seller/groups/${id}/orders`, { token }) });

  if (q.isLoading) return <p className="text-muted">불러오는 중…</p>;
  if (q.error) return <Notice tone="error">{(q.error as Error).message}</Notice>;
  const d = q.data!;
  const missing = d.orders.filter((o) => !o.shipping).length;
  const changed = d.orders.filter((o) => o.shipping && !o.shippingMatches).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[28px] font-extrabold tracking-tight">
          #{id} {group?.product?.name ?? "공구"}
        </h1>
        <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-sm font-bold">{STATUS_LABEL[d.status]}</span>
      </div>
      <p className="-mt-3 text-[15px] text-muted">
        참여 {d.orders.length}명 · {d.totalQty}개
        {Number(d.checkedPrice) > 0 && ` · 확인 가격 ${won(BigInt(d.checkedPrice))}`}
      </p>

      <ShipmentBox id={id} data={d} onDone={() => void q.refetch()} />

      {(missing > 0 || changed > 0) && (
        <Notice tone="error">
          {missing > 0 && `배송지가 없는 참여자 ${missing}명. `}
          {changed > 0 && `참여 뒤 배송지를 바꾼 참여자 ${changed}명 — 참여할 때 체인에 남긴 배송지와 지금 배송지가 달라요. 확인 후 발송해 주세요.`}
        </Notice>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="section-title">배송지 목록</h2>
        {d.orders.length === 0 ? (
          <p className="text-muted">아직 참여자가 없어요.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-paper text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">참여자</th>
                  <th className="px-4 py-3 font-medium">수량</th>
                  <th className="px-4 py-3 font-medium">받는 분 · 연락처</th>
                  <th className="px-4 py-3 font-medium">주소</th>
                  <th className="px-4 py-3 font-medium">체인 기록과 일치</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.orders.map((o) => (
                  <tr key={o.address}>
                    <td className="px-4 py-3">
                      <strong className="block">{o.nickname || "-"}</strong>
                      <code className="text-xs text-muted">
                        {o.address.slice(0, 6)}…{o.address.slice(-4)}
                      </code>
                    </td>
                    <td className="px-4 py-3">{o.qty}개</td>
                    <td className="px-4 py-3">{o.shipping ? `${o.shipping.name} · ${o.shipping.phone}` : <span className="text-accent">배송지 없음</span>}</td>
                    <td className="px-4 py-3">{o.shipping ? `(${o.shipping.zip}) ${o.shipping.address1} ${o.shipping.address2}` : "-"}</td>
                    <td className="px-4 py-3">{o.shipping ? (o.shippingMatches ? "✓" : <span className="font-bold text-accent">다름</span>) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function ShipmentBox({ id, data, onDone }: { id: number; data: Orders; onDone: () => void }) {
  const { session } = useAuth();
  const [no, setNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (data.shipment)
    return (
      <Notice tone="ok">
        운송장 <strong>{data.shipment.trackingNo}</strong> 등록됨 ·{" "}
        {data.shipment.deliveryStatus === "delivered" ? "배송 완료 (에이전트가 체인에 기록해요)" : "배송 중"}
      </Notice>
    );
  if (data.status !== "PAID")
    return <Notice>결제가 완료되면 운송장을 등록할 수 있어요. 지금 상태: {STATUS_LABEL[data.status]}</Notice>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/seller/groups/${id}/shipment`, { token: session!.token, body: { trackingNo: no.trim() } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border-2 border-accent p-5">
      <strong>결제 완료 · 상품을 보내고 운송장을 등록해 주세요</strong>
      <p className="text-sm text-muted">등록하면 에이전트가 주문 증거를 체인에 남기고, 배송 완료를 확인하면 이의 기간(7일)이 시작돼요.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <Field label="운송장 번호">
            <input className="input" required value={no} onChange={(e) => setNo(e.target.value)} placeholder="숫자·영문 6~30자" />
          </Field>
        </div>
        <button type="submit" className="btn-primary h-12 px-6" disabled={busy}>
          {busy ? "등록 중…" : "운송장 등록"}
        </button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </form>
  );
}
