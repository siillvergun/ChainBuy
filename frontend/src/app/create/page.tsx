"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, usePublicClient } from "wagmi";
import { useTx } from "@/lib/useTx";
import { chainBuyAbi } from "@/lib/contracts.generated";
import { CHAINBUY_ADDRESS } from "@/lib/config";
import { products, productHash, sellerIdHash, sellers, toToken } from "@/lib/groups";
import { ProductThumb } from "@/components/ProductThumb";

const ALLOWED = ["coupang.com", "smartstore.naver.com", "11st.co.kr"];

export default function CreatePage() {
  const [kind, setKind] = useState<"listed" | "external">("listed");

  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-8 px-4 py-10 md:px-6">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">공동구매 열기</h1>
        <p className="mt-2 text-sm text-muted">조건은 공구를 만들 때 체인에 기록되고, 이후에는 누구도 바꿀 수 없어요.</p>
      </div>

      <div role="tablist" className="grid grid-cols-2 gap-3">
        {[
          { v: "listed", t: "판매자 특가 상품으로", d: "입점 판매자 상품 · 구매자 수수료 0원 · 판매자에게 바로 결제" },
          { v: "external", t: "대형 쇼핑몰 상품 제안", d: "링크로 제안 · 담당자 확인 후 열림 · 이용료 5%" },
        ].map((o) => (
          <button
            key={o.v}
            type="button"
            role="tab"
            aria-selected={kind === o.v}
            onClick={() => setKind(o.v as "listed" | "external")}
            className={`rounded-lg border-2 p-4 text-left ${kind === o.v ? "border-accent bg-accent-tint" : "border-line hover:border-ink"}`}
          >
            <strong className="block">{o.t}</strong>
            <span className="mt-1 block text-sm text-[#4A4A4A]">{o.d}</span>
          </button>
        ))}
      </div>

      {kind === "listed" ? <ListedForm /> : <ExternalForm />}
    </div>
  );
}

function ListedForm() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const client = usePublicClient();
  const tx = useTx();
  const [pid, setPid] = useState(products[0].id);
  const product = products.find((p) => p.id === pid)!;
  const [price, setPrice] = useState(product.price);
  const [target, setTarget] = useState(20);
  const [perUser, setPerUser] = useState(2);
  const [days, setDays] = useState(3);
  const seller = sellers.find((s) => s.id === product.seller);

  const pick = (id: string) => {
    setPid(id);
    setPrice(products.find((p) => p.id === id)!.price);
  };

  const submit = async () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + days * 86_400);
    try {
      await tx.send("공구 만드는 중", {
        address: CHAINBUY_ADDRESS!,
        abi: chainBuyAbi,
        functionName: "createListedGroup",
        args: [
          sellerIdHash(product.seller),
          { productHash: productHash(product.id), maxPrice: toToken(price), targetQty: target, maxPerUser: perUser, deadline },
        ],
      });
      const count = await client!.readContract({ address: CHAINBUY_ADDRESS!, abi: chainBuyAbi, functionName: "groupCount" });
      router.push(`/groups/${count}`);
    } catch {
      /* tx.error 표시 */
    }
  };

  const invalid = price <= 0 || target <= 0 || perUser <= 0 || perUser > target || days <= 0;

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="label mb-3">상품 선택</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p.id)}
              aria-pressed={pid === p.id}
              className={`overflow-hidden rounded-lg border-2 text-left ${pid === p.id ? "border-accent" : "border-transparent"}`}
            >
              <ProductThumb product={p} className="aspect-[4/3] w-full" />
              <span className="block p-2 text-sm leading-snug">{p.name}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">
          판매자: <strong className="text-ink">{seller?.name}</strong> · 결제는 이 판매자의 등록된 지갑으로만 가요.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="최대 가격 (1개)" hint={`정가 ${product.originalPrice.toLocaleString()}원 · 실제 가격이 더 낮으면 차액 환불`}>
          <input className="input" type="number" min={1} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        </Field>
        <Field label="목표 수량" hint="목표가 다 차면 바로 상품 확인 단계로 넘어가요">
          <input className="input" type="number" min={1} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
        </Field>
        <Field label="1인 최대 수량">
          <input className="input" type="number" min={1} value={perUser} onChange={(e) => setPerUser(Number(e.target.value))} />
        </Field>
        <Field label="모집 기간 (일)">
          <input className="input" type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </Field>
      </section>

      <div className="rounded-lg bg-paper p-4 text-sm leading-6 text-[#4A4A4A]">
        • 목표 수량이 안 모이면 참여자 전원에게 전액 환불돼요.
        <br />• 가격이 최대 가격보다 오르거나 품절이면 결제하지 않고 전액 환불돼요.
        <br />• 플랫폼 수수료 5%는 판매자가 부담해요. 구매자는 표시된 가격만 내요.
      </div>

      {tx.error && <p role="alert" className="rounded-lg bg-accent-tint p-3 text-sm text-accent-dark">{tx.error}</p>}
      <button type="button" className="btn-primary h-[52px] text-base" disabled={!isConnected || invalid || !!tx.pending} onClick={submit}>
        {!isConnected ? "지갑을 연결해 주세요" : (tx.pending ?? "공구 열기")}
      </button>
    </div>
  );
}

function ExternalForm() {
  const [url, setUrl] = useState("");
  let host = "";
  try {
    host = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    host = "";
  }
  const allowed = ALLOWED.some((d) => host === d || host.endsWith(`.${d}`));
  const httpsOk = url.startsWith("https://");

  return (
    <div className="flex flex-col gap-6">
      <Field label="상품 링크" hint={`허용 쇼핑몰: ${ALLOWED.join(", ")} · 단축 URL은 받지 않아요`}>
        <input className="input" type="url" placeholder="https://www.coupang.com/vp/products/..." value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      {url && (
        <p className={`rounded-lg p-3 text-sm font-bold ${allowed && httpsOk ? "bg-safe-tint text-safe" : "bg-accent-tint text-accent-dark"}`}>
          {allowed && httpsOk ? `${host} — 허용된 쇼핑몰이에요` : "허용되지 않은 링크예요. 이 상품은 '수요 모으기'로 관심을 모을 수 있어요."}
        </p>
      )}
      <div className="rounded-lg bg-paper p-4 text-sm leading-6 text-[#4A4A4A]">
        • 제안한 링크는 AI가 상품 정보를 읽고, 담당자가 확인한 뒤 공구로 열려요.
        <br />• 결제는 그 쇼핑몰에서만 쓸 수 있는 일회용 카드로 이루어져요. 등록자에게 돈이 가지 않아요.
        <br />• 이용료 5%가 예치금에 포함되고, 상품 화면에 표시돼요.
      </div>
      <button type="button" className="btn-dark h-[52px] text-base" disabled>
        공구 제안하기 (백엔드 연동 후 제공)
      </button>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}
