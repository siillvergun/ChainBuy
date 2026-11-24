"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

/** 로그인·회원가입 화면. 계정 기능은 백엔드(api) 단계에서 연결한다. 지금은 지갑 연결만으로 참여할 수 있다. */
function Login() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<"login" | "signup">(sp.get("tab") === "signup" ? "signup" : "login");
  const login = tab === "login";
  const verb = login ? "로그인" : "시작하기";

  return (
    <div className="mx-auto flex max-w-[440px] flex-col gap-6 px-4 py-14">
      <div role="tablist" className="grid grid-cols-2 border-b border-line">
        {(["login", "signup"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px h-[52px] border-b-2 text-base ${tab === t ? "border-ink font-bold text-ink" : "border-transparent text-muted"}`}
          >
            {t === "login" ? "로그인" : "회원가입"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        <button type="button" disabled className="h-[52px] rounded-md bg-[#FEE500] text-[15px] font-bold text-[#191600] disabled:opacity-60">
          카카오로 {verb}
        </button>
        <button type="button" disabled className="h-[52px] rounded-md bg-[#03A94D] text-[15px] font-bold text-white disabled:opacity-60">
          네이버로 {verb}
        </button>
      </div>

      <div className="flex items-center gap-3 text-[13px] text-muted">
        <span className="h-px flex-1 bg-line" />
        또는 이메일로
        <span className="h-px flex-1 bg-line" />
      </div>

      <form className="flex flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
        <label className="flex flex-col gap-1.5">
          <span className="label">이메일</span>
          <input className="input" type="email" autoComplete="email" placeholder="you@example.com" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">비밀번호</span>
          <input className="input" type="password" autoComplete={login ? "current-password" : "new-password"} placeholder={login ? "" : "8자 이상, 영문·숫자 포함"} />
        </label>
        {!login && (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="label">닉네임</span>
              <input className="input" type="text" autoComplete="nickname" placeholder="공구 추천에 표시돼요" />
            </label>
            <fieldset className="mt-1 flex flex-col rounded-md border border-line px-4 py-3">
              <legend className="px-1 text-sm font-bold">약관 동의</legend>
              {["전체 동의", "[필수] 이용약관", "[필수] 개인정보 수집·이용", "[선택] 마감 임박·특가 알림 받기"].map((t, i) => (
                <label key={t} className={`flex min-h-10 items-center gap-2 text-sm ${i === 0 ? "font-bold" : "text-[#4A4A4A]"}`}>
                  <input type="checkbox" className="h-[18px] w-[18px]" />
                  {t}
                </label>
              ))}
            </fieldset>
          </>
        )}
        <button type="submit" disabled className={`${login ? "btn-dark" : "btn-primary"} h-[52px] text-base`}>
          {login ? "로그인" : "가입하기"}
        </button>
      </form>

      <div className="rounded-lg bg-paper p-4 text-[13px] leading-6 text-[#4A4A4A]">
        계정 기능은 준비 중이에요. 지금은 상단의 <strong className="text-ink">지갑 연결</strong>만으로 공구에 참여할 수 있고, 참여금은 지갑에서 컨트랙트로
        바로 예치돼요.
      </div>
    </div>
  );
}
