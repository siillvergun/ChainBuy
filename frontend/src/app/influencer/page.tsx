"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, MyInfluencer, OAuthProvider } from "@/lib/api";
import { useGroups } from "@/lib/hooks";
import { useAuth } from "@/components/AuthProvider";
import { LoginGate } from "@/components/LoginGate";
import { Field, Notice } from "@/components/Field";

/**
 * 인플루언서 페이지
 * 1) 프로필(핸들) 만들기 → 2) SNS 계정을 OAuth로 연결해 인증 → 3) 판매자가 보낸 협찬 태그 수락
 */
export default function InfluencerPage() {
  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-8 px-4 py-10 md:px-6">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">인플루언서</h1>
        <p className="mt-2 text-[15px] text-muted">
          SNS 계정을 연결해 인증하면, 판매자가 공구에 나를 협찬 인플루언서로 태그할 수 있어요. 내가 수락한 공구만 공개돼요.
        </p>
      </div>
      <Suspense>
        <OAuthResult />
      </Suspense>
      <LoginGate what="인플루언서 페이지">
        <InfluencerHome />
      </LoginGate>
    </div>
  );
}

const PLATFORM_LABEL: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", threads: "Threads", tiktok: "TikTok", mock: "테스트 계정" };

/** OAuth 콜백에서 돌아왔을 때 결과 표시 */
function OAuthResult() {
  const sp = useSearchParams();
  const linked = sp.get("linked");
  const error = sp.get("error");
  if (linked) return <Notice tone="ok">{PLATFORM_LABEL[linked] ?? linked} 계정을 연결했어요.</Notice>;
  if (error) return <Notice tone="error">{error}</Notice>;
  return null;
}

function InfluencerHome() {
  const { session } = useAuth();
  const token = session!.token;
  const me = useQuery({ queryKey: ["influencer-me", token], queryFn: () => api<MyInfluencer | null>("/influencers/me", { token }) });

  if (me.isLoading) return <p className="text-muted">불러오는 중…</p>;
  if (me.error) return <Notice tone="error">{(me.error as Error).message}</Notice>;

  return (
    <div className="flex flex-col gap-10">
      <ProfileForm me={me.data ?? null} onSaved={() => me.refetch()} />
      {me.data && (
        <>
          <Accounts me={me.data} onChange={() => me.refetch()} />
          <Tags me={me.data} onChange={() => me.refetch()} />
        </>
      )}
    </div>
  );
}

function ProfileForm({ me, onSaved }: { me: MyInfluencer | null; onSaved: () => void }) {
  const { session } = useAuth();
  const [f, setF] = useState({ handle: me?.handle ?? "", name: me?.name ?? "", bio: me?.bio ?? "" });
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (me) setF({ handle: me.handle, name: me.name, bio: me.bio });
  }, [me]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api("/influencers", { token: session!.token, body: f });
      setMsg({ tone: "ok", text: "프로필을 저장했어요." });
      onSaved();
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-2xl border border-line p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">프로필</h2>
        {me && (
          <Link href={`/i/${me.handle}`} className="text-sm font-bold text-accent">
            내 공구 모아 보기 페이지 ↗
          </Link>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="핸들" hint="영문 소문자·숫자·_·. 3~20자 · 주소가 /i/핸들 이 돼요">
          <input className="input" required value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} placeholder="coffee_lover" />
        </Field>
        <Field label="이름">
          <input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="커피러버" />
        </Field>
      </div>
      <Field label="소개">
        <textarea className="input h-20 py-3" value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} placeholder="어떤 상품을 소개하는지 적어 주세요" />
      </Field>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <button type="submit" className="btn-dark h-12 self-start px-6">
        {me ? "프로필 저장" : "프로필 만들기"}
      </button>
    </form>
  );
}

function Accounts({ me, onChange }: { me: MyInfluencer; onChange: () => void }) {
  const { session } = useAuth();
  const providers = useQuery({ queryKey: ["oauth-providers"], queryFn: () => api<OAuthProvider[]>("/oauth/providers") });
  const [error, setError] = useState<string | null>(null);

  const connect = async (platform: string) => {
    setError(null);
    try {
      const { url } = await api<{ url: string }>(`/oauth/${platform}/start`, { token: session!.token, body: {} });
      window.location.href = url; // SNS 로그인 화면으로 이동 → 확인 후 이 페이지로 돌아옴
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const unlink = async (platform: string) => {
    await api(`/influencers/me/accounts/${platform}`, { token: session!.token, method: "DELETE" });
    onChange();
  };

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line p-6 md:p-8">
      <div>
        <h2 className="section-title">SNS 계정 인증</h2>
        <p className="mt-2 text-[15px] text-muted">
          각 SNS에 로그인해 계정 주인임을 확인해요. 계정 ID와 사용자명만 받고, 글을 쓰거나 데이터를 계속 읽지 않아요.
        </p>
      </div>
      <p className={`text-[15px] font-bold ${me.verified ? "text-safe" : "text-muted"}`}>{me.verified ? "✓ 인증된 인플루언서" : "아직 인증된 계정이 없어요"}</p>
      <ul className="divide-y divide-line rounded-xl border border-line px-5">
        {(providers.data ?? []).map((p) => {
          const acc = me.accounts.find((a) => a.platform === p.platform);
          return (
            <li key={p.platform} className="flex flex-wrap items-center gap-4 py-4">
              <strong className="w-28">{p.label}</strong>
              <span className="min-w-[160px] flex-1 text-[15px]">
                {acc ? (
                  <a href={acc.url} target="_blank" rel="noreferrer" className="font-medium text-safe hover:underline">
                    ✓ {acc.username}
                  </a>
                ) : p.enabled ? (
                  <span className="text-muted">연결 안 됨</span>
                ) : (
                  <span className="text-muted">준비 중 (앱 키 미설정)</span>
                )}
              </span>
              {acc ? (
                <button type="button" className="btn-line" onClick={() => unlink(p.platform)}>
                  연결 해제
                </button>
              ) : (
                <button type="button" className="btn-dark" disabled={!p.enabled} onClick={() => connect(p.platform)}>
                  연결하기
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">OAuth를 지원하지 않는 플랫폼(네이버 블로그 등)은 담당자 이메일로 인증을 요청해 주세요.</p>
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}

const TAG_STATUS = { pending: "수락 대기", accepted: "공개 중", rejected: "거절함", removed: "내림" } as const;

function Tags({ me, onChange }: { me: MyInfluencer; onChange: () => void }) {
  const { session } = useAuth();
  const { groups } = useGroups();
  const name = (id: number) => groups.find((g) => Number(g.id) === id)?.product?.name ?? `공구 #${id}`;

  const respond = async (groupId: number, action: "accept" | "reject" | "remove") => {
    await api(`/tags/${groupId}/respond`, { token: session!.token, body: { action } });
    onChange();
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="section-title">받은 협찬 태그</h2>
      {me.tags.length === 0 ? (
        <p className="text-[15px] text-muted">아직 받은 태그가 없어요. 판매자가 공구에 나를 태그하면 여기에 보여요.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line px-5">
          {me.tags.map((t) => (
            <li key={t.groupId} className="flex flex-wrap items-center gap-4 py-4">
              <Link href={`/groups/${t.groupId}`} className="min-w-[200px] flex-1 font-medium hover:underline">
                {name(t.groupId)}
              </Link>
              <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-sm font-bold">{TAG_STATUS[t.status]}</span>
              {t.status === "pending" && (
                <>
                  <button type="button" className="btn-primary" onClick={() => respond(t.groupId, "accept")}>
                    수락
                  </button>
                  <button type="button" className="btn-line" onClick={() => respond(t.groupId, "reject")}>
                    거절
                  </button>
                </>
              )}
              {t.status === "accepted" && (
                <button type="button" className="btn-line" onClick={() => respond(t.groupId, "remove")}>
                  태그 내리기
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
