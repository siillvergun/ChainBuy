/**
 * SNS 계정 소유 확인용 OAuth 제공자.
 * 각 제공자는 "로그인 화면 주소 만들기"와 "코드 → 계정 ID·사용자명" 두 가지만 한다.
 * 받은 액세스 토큰은 계정 조회에 한 번 쓰고 저장하지 않는다.
 *
 * 앱 키가 환경 변수에 있는 제공자만 켜진다. (README의 'OAuth 앱 등록' 참고)
 */
import crypto from "crypto";
import { API_PUBLIC_URL, ENABLE_MOCK_OAUTH } from "./config.js";

export type Platform = "youtube" | "instagram" | "threads" | "tiktok" | "mock";

export type VerifiedAccount = { platformUserId: string; username: string; url: string };

type Provider = {
  label: string;
  enabled: () => boolean;
  authorizeUrl: (state: string, verifier: string) => string;
  exchange: (code: string, verifier: string) => Promise<VerifiedAccount>;
};

export const redirectUri = (p: Platform) => `${API_PUBLIC_URL}/oauth/${p}/callback`;
const env = (k: string) => process.env[k] ?? "";

async function json(res: Response, what: string) {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${what} 실패 (${res.status}): ${JSON.stringify(body)?.slice(0, 200)}`);
  return body;
}

const form = (o: Record<string, string>) => new URLSearchParams(o);

/** PKCE: verifier → S256 challenge */
export const pkceChallenge = (verifier: string) => crypto.createHash("sha256").update(verifier).digest("base64url");

export const PROVIDERS: Record<Platform, Provider> = {
  // Google OAuth + YouTube Data API: 로그인한 구글 계정의 내 채널
  youtube: {
    label: "YouTube",
    enabled: () => !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET")),
    authorizeUrl: (state, verifier) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${form({
        client_id: env("GOOGLE_CLIENT_ID"),
        redirect_uri: redirectUri("youtube"),
        response_type: "code",
        scope: "https://www.googleapis.com/auth/youtube.readonly",
        state,
        code_challenge: pkceChallenge(verifier),
        code_challenge_method: "S256",
        prompt: "select_account",
      })}`,
    exchange: async (code, verifier) => {
      const tok = await json(
        await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          body: form({
            code,
            client_id: env("GOOGLE_CLIENT_ID"),
            client_secret: env("GOOGLE_CLIENT_SECRET"),
            redirect_uri: redirectUri("youtube"),
            grant_type: "authorization_code",
            code_verifier: verifier,
          }),
        }),
        "구글 토큰 교환"
      );
      const ch = await json(
        await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
          headers: { authorization: `Bearer ${tok.access_token}` },
        }),
        "유튜브 채널 조회"
      );
      const item = ch.items?.[0];
      if (!item) throw new Error("이 구글 계정에 유튜브 채널이 없어요.");
      const handle = item.snippet.customUrl as string | undefined; // 예: @coffeelover
      return {
        platformUserId: item.id,
        username: handle ?? item.snippet.title,
        url: handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${item.id}`,
      };
    },
  },

  // Instagram API with Instagram Login: 프로페셔널(비즈니스·크리에이터) 계정
  instagram: {
    label: "Instagram",
    enabled: () => !!(env("INSTAGRAM_CLIENT_ID") && env("INSTAGRAM_CLIENT_SECRET")),
    authorizeUrl: (state) =>
      `https://www.instagram.com/oauth/authorize?${form({
        client_id: env("INSTAGRAM_CLIENT_ID"),
        redirect_uri: redirectUri("instagram"),
        response_type: "code",
        scope: "instagram_business_basic",
        state,
      })}`,
    exchange: async (code) => {
      const tok = await json(
        await fetch("https://api.instagram.com/oauth/access_token", {
          method: "POST",
          body: form({
            client_id: env("INSTAGRAM_CLIENT_ID"),
            client_secret: env("INSTAGRAM_CLIENT_SECRET"),
            grant_type: "authorization_code",
            redirect_uri: redirectUri("instagram"),
            code,
          }),
        }),
        "인스타그램 토큰 교환"
      );
      const me = await json(
        await fetch(`https://graph.instagram.com/me?fields=user_id,username&access_token=${encodeURIComponent(tok.access_token)}`),
        "인스타그램 계정 조회"
      );
      return { platformUserId: String(me.user_id ?? me.id), username: `@${me.username}`, url: `https://www.instagram.com/${me.username}` };
    },
  },

  // Threads API
  threads: {
    label: "Threads",
    enabled: () => !!(env("THREADS_CLIENT_ID") && env("THREADS_CLIENT_SECRET")),
    authorizeUrl: (state) =>
      `https://threads.net/oauth/authorize?${form({
        client_id: env("THREADS_CLIENT_ID"),
        redirect_uri: redirectUri("threads"),
        response_type: "code",
        scope: "threads_basic",
        state,
      })}`,
    exchange: async (code) => {
      const tok = await json(
        await fetch("https://graph.threads.net/oauth/access_token", {
          method: "POST",
          body: form({
            client_id: env("THREADS_CLIENT_ID"),
            client_secret: env("THREADS_CLIENT_SECRET"),
            grant_type: "authorization_code",
            redirect_uri: redirectUri("threads"),
            code,
          }),
        }),
        "스레드 토큰 교환"
      );
      const me = await json(
        await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(tok.access_token)}`),
        "스레드 계정 조회"
      );
      return { platformUserId: String(me.id), username: `@${me.username}`, url: `https://www.threads.net/@${me.username}` };
    },
  },

  // TikTok Login Kit (사용자명은 user.info.profile 권한)
  tiktok: {
    label: "TikTok",
    enabled: () => !!(env("TIKTOK_CLIENT_KEY") && env("TIKTOK_CLIENT_SECRET")),
    authorizeUrl: (state, verifier) =>
      `https://www.tiktok.com/v2/auth/authorize/?${form({
        client_key: env("TIKTOK_CLIENT_KEY"),
        redirect_uri: redirectUri("tiktok"),
        response_type: "code",
        scope: "user.info.basic,user.info.profile",
        state,
        code_challenge: pkceChallenge(verifier),
        code_challenge_method: "S256",
      })}`,
    exchange: async (code, verifier) => {
      const tok = await json(
        await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form({
            client_key: env("TIKTOK_CLIENT_KEY"),
            client_secret: env("TIKTOK_CLIENT_SECRET"),
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri("tiktok"),
            code_verifier: verifier,
          }),
        }),
        "틱톡 토큰 교환"
      );
      const me = await json(
        await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,username,display_name", {
          headers: { authorization: `Bearer ${tok.access_token}` },
        }),
        "틱톡 계정 조회"
      );
      const u = me.data?.user;
      if (!u?.username) throw new Error("틱톡 사용자명을 받지 못했어요. (user.info.profile 권한 필요)");
      return { platformUserId: String(u.open_id), username: `@${u.username}`, url: `https://www.tiktok.com/@${u.username}` };
    },
  },

  // 개발용: 실제 SNS 대신 이 API가 띄우는 확인 화면에서 사용자명을 입력한다
  mock: {
    label: "테스트 계정",
    enabled: () => ENABLE_MOCK_OAUTH,
    authorizeUrl: (state) => `${API_PUBLIC_URL}/oauth/mock/authorize?state=${state}`,
    exchange: async (code) => {
      const username = code.replace(/[^a-z0-9_.]/gi, "").slice(0, 30) || "tester";
      return { platformUserId: `mock-${username}`, username: `@${username}`, url: `https://example.com/@${username}` };
    },
  },
};

export const PLATFORMS = Object.keys(PROVIDERS) as Platform[];
