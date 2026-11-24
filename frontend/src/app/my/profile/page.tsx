"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Seller, Shipping, UserProfile } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { useAuth } from "@/components/AuthProvider";
import { LoginGate } from "@/components/LoginGate";
import { Field, Notice } from "@/components/Field";

export default function ProfilePage() {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-8 px-4 py-10 md:px-6">
      <div>
        <p className="text-sm text-muted">
          <Link href="/my" className="hover:text-ink">
            마이페이지
          </Link>{" "}
          › 프로필 변경
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-tight">프로필 변경</h1>
      </div>
      <LoginGate what="프로필 변경">
        <Suspense>
          <ProfileForms />
        </Suspense>
      </LoginGate>
    </div>
  );
}

const emptyShip: Shipping = { name: "", phone: "", zip: "", address1: "", address2: "" };

function ProfileForms() {
  const { session } = useAuth();
  const token = session!.token;
  const me = useMe(token);
  const seller = useQuery({ queryKey: ["seller-me", token], queryFn: () => api<Seller | null>("/sellers/me", { token }) });

  if (me.isLoading) return <p className="text-muted">불러오는 중…</p>;
  if (me.error) return <Notice tone="error">{(me.error as Error).message}</Notice>;
  return (
    <>
      <BasicForm me={me.data!} />
      {seller.data && seller.data.status !== "rejected" && <SellerForm seller={seller.data} />}
      <section className="rounded-2xl border border-line p-6 text-[15px] md:p-8">
        <h2 className="section-title">인플루언서 프로필</h2>
        <p className="mt-2 text-muted">핸들·소개·SNS 계정 인증은 인플루언서 페이지에서 바꿀 수 있어요.</p>
        <Link href="/influencer" className="btn-line mt-4">
          인플루언서 페이지로
        </Link>
      </section>
    </>
  );
}

function BasicForm({ me }: { me: UserProfile }) {
  const { session } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const qc = useQueryClient();
  const [f, setF] = useState({ nickname: me.nickname, contact: me.contact });
  const [ship, setShip] = useState<Shipping>(me.shipping ?? emptyShip);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF({ nickname: me.nickname, contact: me.contact });
    setShip(me.shipping ?? emptyShip);
  }, [me]);

  const hasShip = Object.values(ship).some((v) => v.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const saved = await api<UserProfile>("/users/me", { token: session!.token, method: "PUT", body: { ...f, shipping: hasShip ? ship : null } });
      qc.setQueryData(["me", session!.token], saved);
      // 참여하다가 배송지 등록하러 온 경우 원래 공구로 돌아간다
      if (next?.startsWith("/") && !next.startsWith("//") && saved.recipientHash) return router.push(next);
      setMsg({ tone: "ok", text: "저장했어요." });
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 rounded-2xl border border-line p-6 md:p-8">
      <section className="flex flex-col gap-4">
        <h2 className="section-title">기본 정보</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="닉네임" hint="헤더와 마이페이지에 보여요">
            <input className="input" maxLength={20} value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} placeholder="길동" />
          </Field>
          <Field label="연락처 (선택)" hint="이메일 또는 전화번호">
            <input className="input" maxLength={80} value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
          </Field>
        </div>
        <Field label="지갑 주소" hint="지갑이 곧 계정이라 바꿀 수 없어요">
          <input className="input bg-paper font-mono text-sm" readOnly value={me.address} />
        </Field>
      </section>

      <section className="flex flex-col gap-4 border-t border-line pt-6">
        <div>
          <h2 className="section-title">배송지</h2>
          <p className="mt-1 text-sm text-muted">공구에 참여하려면 필요해요. 원문은 서버에만 저장되고, 체인에는 알아볼 수 없는 해시만 기록돼요.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="받는 분">
            <input className="input" value={ship.name} onChange={(e) => setShip({ ...ship, name: e.target.value })} placeholder="홍길동" />
          </Field>
          <Field label="전화번호">
            <input className="input" inputMode="tel" value={ship.phone} onChange={(e) => setShip({ ...ship, phone: e.target.value })} placeholder="010-1234-5678" />
          </Field>
          <Field label="우편번호">
            <input className="input" inputMode="numeric" maxLength={5} value={ship.zip} onChange={(e) => setShip({ ...ship, zip: e.target.value })} placeholder="06236" />
          </Field>
          <div className="hidden sm:block" />
          <div className="sm:col-span-2">
            <Field label="주소">
              <input className="input" value={ship.address1} onChange={(e) => setShip({ ...ship, address1: e.target.value })} placeholder="서울특별시 강남구 테헤란로 123" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="상세 주소">
              <input className="input" value={ship.address2} onChange={(e) => setShip({ ...ship, address2: e.target.value })} placeholder="4층" />
            </Field>
          </div>
        </div>
        {me.shipping && !hasShip && <Notice tone="error">배송지를 모두 지우면 새 공구에 참여할 수 없어요.</Notice>}
        <p className="text-xs text-muted">이미 참여한 공구에는 참여할 때의 배송지 해시가 기록돼 있어요. 배송지를 바꾸면 이후 참여부터 적용돼요.</p>
      </section>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <button type="submit" className="btn-primary h-12 self-start px-8" disabled={busy}>
        {busy ? "저장하는 중…" : "저장"}
      </button>
    </form>
  );
}

function SellerForm({ seller }: { seller: Seller }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: seller.name, contact: seller.contact });
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api("/sellers/me", { token: session!.token, method: "PATCH", body: f });
      await qc.invalidateQueries({ queryKey: ["seller-me"] });
      setMsg({ tone: "ok", text: "판매자 정보를 저장했어요." });
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line p-6 md:p-8">
      <h2 className="section-title">판매자 정보</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="상호">
          <input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="연락처">
          <input className="input" required value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
        </Field>
        <Field label="사업자등록번호" hint="바꾸려면 담당자에게 문의해 주세요">
          <input className="input bg-paper" readOnly value={seller.bizNo} />
        </Field>
        <Field label="정산 지갑" hint="입점 신청한 지갑으로 고정돼요">
          <input className="input bg-paper font-mono text-sm" readOnly value={seller.address} />
        </Field>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <button type="submit" className="btn-dark h-12 self-start px-6">
        판매자 정보 저장
      </button>
    </form>
  );
}
