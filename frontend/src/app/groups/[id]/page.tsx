"use client";

import { use, useState } from "react";
import Link from "next/link";
import { keccak256, toBytes } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { useGroup, useMe, useMyParticipation, useSponsorTags } from "@/lib/hooks";
import { useAuth } from "@/components/AuthProvider";
import { SponsorBadge } from "@/components/SponsorBadge";
import { useTx } from "@/lib/useTx";
import { chainBuyAbi, mockUsdcAbi } from "@/lib/contracts.generated";
import { CHAINBUY_ADDRESS, USDC_ADDRESS, activeChain } from "@/lib/config";
import { GroupView, STATUS_LABEL, discountRate, remaining, toToken, unitDeposit, won } from "@/lib/groups";
import { ProductThumb } from "@/components/ProductThumb";
import { ChainNotice } from "@/components/States";

export default function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const id = BigInt(idStr);
  const { group: g, isLoading, error, refetch } = useGroup(id);

  if (isLoading) return <div className="mx-auto max-w-page px-6 py-16 text-muted">불러오는 중…</div>;
  if (error || !g || g.targetQty === 0)
    return (
      <div className="mx-auto max-w-page px-4 py-16 md:px-6">
        <ChainNotice error={error} />
        {!error && <p className="text-muted">공구 #{idStr}을(를) 찾을 수 없어요.</p>}
      </div>
    );

  return <Detail g={g} refetch={refetch} />;
}

function Detail({ g, refetch }: { g: GroupView; refetch: () => void }) {
  const tags = useSponsorTags().get(Number(g.id));
  const rate = discountRate(g.product, g.maxPrice);
  const pct = Math.min(100, Math.round((g.totalQty / g.targetQty) * 100));

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6">
      <p className="mb-4 text-sm text-muted">
        <Link href="/groups" className="hover:text-ink">
          전체 공구
        </Link>{" "}
        › {g.product?.category ?? "기타"}
      </p>

      <div className="grid gap-10 md:grid-cols-[1fr_440px]">
        <ProductThumb product={g.product} className="aspect-square w-full rounded-xl" />

        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <span className={`rounded px-2 py-1 ${g.isListed ? "bg-accent-tint text-accent-dark" : "bg-[#F1F1F1] text-[#4A4A4A]"}`}>
              {g.isListed ? "판매자 특가 · 구매자 수수료 0원" : "추천 공구 · 이용료 5% 포함"}
            </span>
            <span className="rounded bg-safe-tint px-2 py-1 text-safe">안심결제</span>
            <span className="rounded bg-[#F1F1F1] px-2 py-1 text-[#4A4A4A]">{STATUS_LABEL[g.statusName]}</span>
          </div>
          <SponsorBadge tags={tags} size="md" />
          <h1 className="text-2xl font-extrabold leading-snug tracking-tight">{g.product?.name ?? `공구 #${g.id}`}</h1>
          {(g.product?.sellerName || g.product?.url) && (
            <p className="-mt-2 text-sm text-muted">
              {g.product.sellerName && <>판매자 {g.product.sellerName}</>}
              {g.product.url && (
                <a href={g.product.url} target="_blank" rel="noreferrer" className="font-bold text-accent">
                  원본 상품 페이지 ↗
                </a>
              )}
            </p>
          )}
          {g.product?.description && <p className="text-[15px] leading-6 text-[#4A4A4A]">{g.product.description}</p>}

          <div>
            {g.product &&
              (rate > 0 ? (
                <p className="text-sm text-muted line-through">{g.product.originalPrice.toLocaleString()}원</p>
              ) : (
                !g.isListed && <p className="text-sm text-muted">쇼핑몰 현재가 {g.product.originalPrice.toLocaleString()}원</p>
              ))}
            <p className="flex items-baseline gap-2">
              {rate > 0 && <span className="text-3xl font-extrabold text-accent">{rate}%</span>}
              <span className="text-3xl font-extrabold">{won(g.maxPrice)}</span>
            </p>
            <p className="mt-1 text-xs text-muted">최대 가격 기준 · 실제 가격이 더 낮으면 차액을 돌려드려요</p>
          </div>

          <div className="rounded-lg border border-line p-4">
            <div className="flex justify-between text-sm">
              <strong className="text-accent">
                {g.totalQty}/{g.targetQty}개 모임 ({pct}%)
              </strong>
              <span className="text-muted">{g.statusName === "OPEN" ? remaining(g.deadline) : STATUS_LABEL[g.statusName]}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <Actions g={g} refetch={refetch} />
        </div>
      </div>

      <div className="mt-16 grid gap-8 lg:grid-cols-[3fr_2fr]">
        <section className="rounded-2xl border border-line p-6 md:p-8">
          <h2 className="section-title">고정된 조건</h2>
          <p className="mt-2 text-[15px] text-muted">공구를 만들 때 체인에 기록돼서 누구도 바꿀 수 없어요.</p>
          <dl className="mt-6 grid grid-cols-1 gap-x-6 border-t border-line pt-2 text-[15px] sm:grid-cols-[140px_1fr] md:text-base">
            <Row label="옵션">{g.product?.option ?? "-"}</Row>
            <Row label="최대 가격">
              <strong>{won(g.maxPrice)}</strong> / 개
            </Row>
            <Row label="목표 수량">
              {g.targetQty}개 · 1인 최대 {g.maxPerUser}개
            </Row>
            <Row label="마감">{new Date(Number(g.deadline) * 1000).toLocaleString("ko-KR")}</Row>
            <Row label="플랫폼 수수료">
              {g.feeBps / 100}% · {g.isListed ? "판매자 부담" : "구매자 부담(예치금에 포함)"}
            </Row>
            <Row label="결제 대상">
              <span className="block">{g.isListed ? "등록된 판매자 지갑" : "허용 쇼핑몰 전용 카드"}</span>
              <Hex value={g.payee} />
            </Row>
            <Row label="상품 해시">
              <Hex value={g.productHash} />
            </Row>
          </dl>
          {activeChain.blockExplorers?.default && (
            <a
              className="mt-6 inline-block text-[15px] font-bold text-accent"
              href={`${activeChain.blockExplorers.default.url}/address/${CHAINBUY_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
            >
              블록 탐색기에서 컨트랙트 보기 ↗
            </a>
          )}
        </section>
        <Timeline g={g} />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-4 text-muted sm:border-b sm:border-line sm:pb-4">{label}</dt>
      <dd className="min-w-0 border-b border-line pb-4 pt-1 sm:pt-4">{children}</dd>
    </>
  );
}

/** 주소·해시는 자르지 않고 전부 보여 주고, 복사 버튼을 단다 */
function Hex({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="mt-1 flex items-start gap-2">
      <code className="min-w-0 flex-1 break-all rounded-md bg-paper px-2.5 py-1.5 font-mono text-[13px] leading-5 text-ink">{value}</code>
      <button
        type="button"
        className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-[13px] font-bold hover:border-ink"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* 클립보드 권한이 없으면 무시 */
          }
        }}
      >
        {copied ? "복사됨" : "복사"}
      </button>
    </span>
  );
}

const STEPS: { key: string; label: string; desc: string }[] = [
  { key: "OPEN", label: "모집", desc: "참여금은 컨트랙트에 보관돼요" },
  { key: "PENDING_CHECK", label: "상품 확인", desc: "AI가 가격·재고·옵션을 확인해요" },
  { key: "APPROVED", label: "결제 승인", desc: "담당자가 확인 결과를 승인해요" },
  { key: "PAID", label: "결제", desc: "등록된 결제 대상에게만 보내요" },
  { key: "SHIPPED", label: "배송 완료", desc: "7일 동안 이의를 받아요" },
  { key: "COMPLETED", label: "거래 종료", desc: "수수료는 수령 확인 후 지급돼요" },
];

function Timeline({ g }: { g: GroupView }) {
  const order = ["OPEN", "PENDING_CHECK", "APPROVED", "PAID", "SHIPPED", "COMPLETED"];
  const failed = g.statusName === "FAILED" || g.statusName === "CANCELLED";
  const at = order.indexOf(g.statusName);
  return (
    <section className="rounded-2xl border border-line p-6 md:p-8">
      <h2 className="section-title mb-6">진행 과정</h2>
      {failed && (
        <p className="mb-4 rounded-lg bg-accent-tint p-3 text-[15px] font-bold text-accent-dark">
          {STATUS_LABEL[g.statusName]} — 참여자는 예치금 전액을 돌려받을 수 있어요.
        </p>
      )}
      <ol className="flex flex-col">
        {STEPS.map((s, i) => {
          const done = !failed && i < at;
          const now = !failed && i === at;
          return (
            <li key={s.key} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    now ? "bg-accent text-white" : done ? "bg-ink text-white" : "bg-line text-muted"
                  }`}
                >
                  {i + 1}
                </span>
                {i < STEPS.length - 1 && <span className={`w-px flex-1 ${done ? "bg-ink" : "bg-line"}`} />}
              </div>
              <div className="pb-7 pt-1.5">
                <p className={`text-base font-bold ${now ? "text-accent" : done ? "text-ink" : "text-muted"}`}>{s.label}</p>
                <p className="mt-0.5 text-[15px] text-muted">{s.desc}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Actions({ g, refetch }: { g: GroupView; refetch: () => void }) {
  const { address, isConnected } = useAccount();
  const { session } = useAuth();
  const me = useMe(session?.token);
  const recipientHash = me.data?.recipientHash ?? null;
  const here = `/groups/${g.id}`;
  const { participant, refundable, fee, refetch: refetchMe } = useMyParticipation(g.id);
  const tx = useTx();
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");

  const tokenReads = useReadContracts({
    contracts: [
      { address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "balanceOf", args: [address!] },
      { address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "allowance", args: [address!, CHAINBUY_ADDRESS!] },
    ],
    query: { enabled: !!address && !!USDC_ADDRESS && !!CHAINBUY_ADDRESS },
  });
  const balance = (tokenReads.data?.[0]?.result as bigint | undefined) ?? 0n;
  const allowance = (tokenReads.data?.[1]?.result as bigint | undefined) ?? 0n;

  const myQty = participant?.qty ?? 0;
  const left = Math.min(g.maxPerUser - myQty, g.targetQty - g.totalQty);
  const total = unitDeposit(g) * BigInt(qty);
  const open = g.statusName === "OPEN" && Number(g.deadline) * 1000 > Date.now();
  const cb = { address: CHAINBUY_ADDRESS!, abi: chainBuyAbi } as const;

  const after = async () => {
    await Promise.all([refetch(), refetchMe(), tokenReads.refetch()]);
  };
  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      await after();
    } catch {
      /* 에러는 tx.error 로 표시 */
    }
    void label;
  };

  if (!isConnected) {
    return (
      <div className="flex flex-col gap-3 rounded-lg bg-paper p-4 text-sm text-[#4A4A4A]">
        <span>참여하려면 지갑으로 로그인해 주세요. 참여금은 지갑에서 컨트랙트로 바로 예치돼요.</span>
        <Link href={`/login?next=${encodeURIComponent(here)}`} className="btn-primary h-12 text-base">
          로그인하고 참여하기
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {myQty > 0 && (
        <div className="rounded-lg bg-accent-tint p-3 text-sm text-accent-dark">
          <strong>{myQty}개 참여 중</strong> · 예치 {won(participant?.deposited)}
          {participant?.refunded && " · 환불 받음"}
          {fee > 0n && ` · 내 몫 수수료 ${won(fee)}`}
        </div>
      )}

      {open && left > 0 && (
        <>
          <div className="flex items-center justify-between rounded-lg border border-line p-3">
            <span className="text-sm font-bold">수량</span>
            <div className="flex items-center gap-3">
              <button type="button" aria-label="수량 줄이기" className="h-8 w-8 rounded border border-line" onClick={() => setQty(Math.max(1, qty - 1))}>
                −
              </button>
              <span className="w-6 text-center font-bold">{qty}</span>
              <button type="button" aria-label="수량 늘리기" className="h-8 w-8 rounded border border-line" onClick={() => setQty(Math.min(left, qty + 1))}>
                +
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">예치할 금액{!g.isListed && " (이용료 5% 포함)"}</span>
            <strong className="text-xl">{won(total)}</strong>
          </div>

          {!session ? (
            <Link href={`/login?next=${encodeURIComponent(here)}`} className="btn-primary h-[52px] text-base">
              로그인하고 참여하기
            </Link>
          ) : !recipientHash ? (
            <div className="flex flex-col gap-2 rounded-lg border border-accent-line bg-accent-tint p-4 text-sm text-accent-dark">
              <span>참여하려면 배송지를 먼저 등록해야 해요. 체인에는 배송지 원문이 아니라 해시만 기록돼요.</span>
              <Link href={`/my/profile?next=${encodeURIComponent(here)}`} className="btn-primary h-11">
                배송지 등록하기
              </Link>
            </div>
          ) : balance < total ? (
            <button
              type="button"
              className="btn-dark h-[52px] text-base"
              disabled={!!tx.pending}
              onClick={() =>
                run("faucet", () =>
                  tx.send("테스트 토큰 받는 중", { address: USDC_ADDRESS!, abi: mockUsdcAbi, functionName: "mint", args: [address!, toToken(1_000_000)] })
                )
              }
            >
              {tx.pending ?? "테스트 토큰 100만원 받기"}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary h-[52px] text-base"
              disabled={!!tx.pending}
              onClick={() =>
                run("deposit", async () => {
                  if (allowance < total) {
                    await tx.send("토큰 사용 승인 중", { address: USDC_ADDRESS!, abi: mockUsdcAbi, functionName: "approve", args: [CHAINBUY_ADDRESS!, total] });
                  }
                  // 배송지 원문은 서버에만 두고, 체인에는 솔트를 섞은 배송지 해시만 남긴다 (DEP-04)
                  await tx.send("참여금 예치 중", { ...cb, functionName: "deposit", args: [g.id, qty, recipientHash!] });
                })
              }
            >
              {tx.pending ?? `${won(total)} 예치하고 참여하기`}
            </button>
          )}
          {session && me.data?.shipping && (
            <p className="text-xs text-muted">
              배송지: {me.data.shipping.name} · {me.data.shipping.address1} {me.data.shipping.address2}{" "}
              <Link href={`/my/profile?next=${encodeURIComponent(here)}`} className="font-bold underline">
                변경
              </Link>
            </p>
          )}
        </>
      )}

      {open && myQty > 0 && (
        <button type="button" className="btn-line" disabled={!!tx.pending} onClick={() => run("withdraw", () => tx.send("참여 취소 중", { ...cb, functionName: "withdraw", args: [g.id] }))}>
          참여 취소하고 전액 돌려받기
        </button>
      )}

      {refundable > 0n && (
        <button type="button" className="btn-dark h-[52px] text-base" disabled={!!tx.pending} onClick={() => run("refund", () => tx.send("환불 받는 중", { ...cb, functionName: "refund", args: [g.id] }))}>
          {won(refundable)} 환불 받기
        </button>
      )}

      {g.statusName === "SHIPPED" && myQty > 0 && participant?.receipt === 0 && (
        <div className="flex flex-col gap-2 rounded-lg border-2 border-accent p-4">
          <p className="text-sm leading-6">
            상품을 받으셨나요? 확인하면 내 몫의 플랫폼 수수료가 지급돼요. 확인하지 않아도 배송 후 7일 동안 이의가 없으면 지급돼요.
          </p>
          <button type="button" className="btn-primary" disabled={!!tx.pending} onClick={() => run("confirm", () => tx.send("수령 확인 중", { ...cb, functionName: "confirmReceipt", args: [g.id] }))}>
            잘 받았어요
          </button>
          <label className="sr-only" htmlFor="reason">
            문제 내용
          </label>
          <input id="reason" className="input" placeholder="문제가 있다면 내용을 적어 주세요" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            type="button"
            className="btn-line"
            disabled={!!tx.pending || !reason}
            onClick={() => run("dispute", () => tx.send("이의 접수 중", { ...cb, functionName: "dispute", args: [g.id, keccak256(toBytes(reason))] }))}
          >
            문제가 있어요
          </button>
        </div>
      )}
      {participant?.receipt === 1 && <p className="rounded-lg bg-safe-tint p-3 text-sm font-bold text-safe">수령 확인 완료</p>}
      {participant?.receipt === 2 && <p className="rounded-lg bg-accent-tint p-3 text-sm font-bold text-accent-dark">이의 접수됨 · 내 몫 수수료는 담당자 처리 전까지 보류돼요</p>}

      {tx.error && (
        <p role="alert" className="rounded-lg bg-accent-tint p-3 text-sm text-accent-dark">
          {tx.error}
        </p>
      )}
      <p className="text-xs leading-5 text-muted">
        인원이 안 모이거나, 가격이 최대 가격보다 오르거나, 7일 안에 결제되지 않으면 전액 환불돼요.
      </p>
    </div>
  );
}
