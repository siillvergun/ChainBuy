"use client";

import Link from "next/link";
import { useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useSmartAccount } from "@/lib/smartAccount";
import { ParticipationRow, SummaryStats, useParticipations } from "@/components/Participations";
import { ChainNotice, Empty } from "@/components/States";

/** 장바구니: 내가 참여하고 있는 공구(상품) 목록 */
export default function CartPage() {
  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-6 px-4 py-10 md:px-6">
      <h1 className="text-[28px] font-extrabold tracking-tight">장바구니</h1>
      <LoginGate what="장바구니">
        <Cart />
      </LoginGate>
    </div>
  );
}

function Cart() {
  const account = useSmartAccount(); // 참여 기록은 스마트 지갑 주소에 남는다
  const { ongoing, ended, holding, refundable, toConfirm, error, isLoading } = useParticipations(account);
  const [tab, setTab] = useState<"ongoing" | "ended">("ongoing");
  const list = tab === "ongoing" ? ongoing : ended;

  return (
    <>
      <p className="-mt-3 text-[15px] text-muted">참여한 공구의 참여금은 컨트랙트에 보관돼 있어요. 인원이 안 모이거나 가격이 오르면 전액 돌려받아요.</p>
      <ChainNotice error={error} />
      <SummaryStats holding={holding} toConfirm={toConfirm} refundable={refundable} />

      <div role="tablist" className="flex gap-6 border-b border-line">
        {(
          [
            ["ongoing", `참여 중 ${ongoing.length}`],
            ["ended", `종료 ${ended.length}`],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={tab === v}
            onClick={() => setTab(v)}
            className={`-mb-px border-b-2 py-3 text-base ${tab === v ? "border-ink font-bold" : "border-transparent text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-muted">불러오는 중…</p>
      ) : list.length ? (
        <ul className="divide-y divide-line rounded-xl border border-line bg-white px-5">
          {list.map((x) => (
            <ParticipationRow key={String(x.g.id)} x={x} />
          ))}
        </ul>
      ) : (
        <Empty>
          {tab === "ongoing" ? "참여 중인 공구가 없어요." : "종료된 공구가 없어요."}{" "}
          <Link href="/groups" className="font-bold text-accent">
            공구 둘러보기
          </Link>
        </Empty>
      )}
    </>
  );
}
