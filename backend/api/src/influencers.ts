import crypto from "crypto";
import express from "express";
import { z } from "zod";
import { WEB_ORIGIN } from "./config.js";
import { db } from "./db.js";
import { HttpError, requireAuth } from "./auth.js";
import { idHash, onchainGroup } from "./chain.js";
import { h, parse } from "./http.js";
import { PLATFORMS, PROVIDERS, type Platform } from "./oauthProviders.js";

/**
 * 인플루언서 (INF)
 * - 인플루언서는 지갑으로 로그인해 프로필을 만들고, SNS 계정을 OAuth로 연결해 "인증된 인플루언서"가 된다.
 * - 판매자는 자기 공구에 인증된 인플루언서를 태그하고, 인플루언서가 수락해야 협찬 배지가 공개된다.
 */
export const influencerRouter = express.Router();
export const oauthRouter = express.Router();

type Row = Record<string, unknown>;

const accountsOf = (address: unknown) =>
  (db.prepare("SELECT platform, username, url, verified_at FROM influencer_accounts WHERE address = ? ORDER BY verified_at").all(address) as Row[]).map(
    (a) => ({ platform: a.platform as Platform, label: PROVIDERS[a.platform as Platform]?.label ?? a.platform, username: a.username, url: a.url, verifiedAt: a.verified_at })
  );

function profileOut(p: Row) {
  const accounts = accountsOf(p.address);
  return { address: p.address, handle: p.handle, name: p.name, bio: p.bio, verified: accounts.length > 0, accounts };
}

const myProfile = (address?: string) => db.prepare("SELECT * FROM influencers WHERE address = ?").get(address) as Row | undefined;

// ─────────────── 프로필 ───────────────

influencerRouter.post(
  "/influencers",
  requireAuth,
  h((req, res) => {
    const body = parse(
      z.object({
        handle: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9_.]{3,20}$/, "핸들은 영문 소문자·숫자·_·. 3~20자"),
        name: z.string().trim().min(1).max(30),
        bio: z.string().trim().max(200).default(""),
      }),
      req.body
    );
    const taken = db.prepare("SELECT address FROM influencers WHERE handle = ?").get(body.handle) as Row | undefined;
    if (taken && taken.address !== req.address) throw new HttpError(409, "이미 쓰고 있는 핸들이에요.");
    db.prepare(
      `INSERT INTO influencers (address, handle, name, bio, created_at) VALUES (@address, @handle, @name, @bio, @now)
       ON CONFLICT(address) DO UPDATE SET handle = @handle, name = @name, bio = @bio`
    ).run({ ...body, address: req.address, now: Date.now() });
    res.json(profileOut(myProfile(req.address)!));
  })
);

influencerRouter.get(
  "/influencers/me",
  requireAuth,
  h((req, res) => {
    const p = myProfile(req.address);
    if (!p) return res.json(null);
    const tags = db.prepare("SELECT group_id, seller, status, created_at FROM group_tags WHERE influencer = ? ORDER BY created_at DESC").all(req.address) as Row[];
    res.json({
      ...profileOut(p),
      tags: tags.map((t) => ({ groupId: t.group_id, seller: t.seller, status: t.status, createdAt: t.created_at })),
    });
  })
);

/** 판매자가 태그할 때 고르는 목록: 인증된 인플루언서만 */
influencerRouter.get("/influencers", (_req, res) => {
  const rows = db.prepare("SELECT * FROM influencers ORDER BY handle").all() as Row[];
  res.json(rows.map(profileOut).filter((p) => p.verified));
});

influencerRouter.get("/influencers/:handle", (req, res, next) => {
  const p = db.prepare("SELECT * FROM influencers WHERE handle = ?").get(req.params.handle.toLowerCase()) as Row | undefined;
  if (!p) return next(new HttpError(404, "인플루언서를 찾을 수 없어요."));
  const groups = db.prepare("SELECT group_id FROM group_tags WHERE influencer = ? AND status = 'accepted' ORDER BY group_id DESC").all(p.address) as Row[];
  res.json({ ...profileOut(p), groupIds: groups.map((g) => g.group_id) });
});

influencerRouter.delete(
  "/influencers/me/accounts/:platform",
  requireAuth,
  h((req, res) => {
    db.prepare("DELETE FROM influencer_accounts WHERE address = ? AND platform = ?").run(req.address, req.params.platform);
    res.json(profileOut(myProfile(req.address)!));
  })
);

// ─────────────── 공구 협찬 태그 ───────────────

/** 판매자가 자기 공구에 인증된 인플루언서를 태그한다 (수락 전에는 비공개) */
influencerRouter.post(
  "/groups/:id/tags",
  requireAuth,
  h(async (req, res) => {
    const groupId = Number(req.params.id);
    const { handle } = parse(z.object({ handle: z.string().trim().toLowerCase().transform((s) => s.replace(/^@/, "")) }), req.body);
    const seller = db.prepare("SELECT * FROM sellers WHERE address = ? AND status = 'approved'").get(req.address) as Row | undefined;
    if (!seller) throw new HttpError(403, "승인된 판매자만 태그할 수 있어요.");
    const g = await onchainGroup(BigInt(groupId)).catch(() => null);
    if (!g || g.kind !== 0 || g.partyId !== idHash(String(seller.id))) throw new HttpError(403, "내가 연 공구에만 태그할 수 있어요.");

    const inf = db.prepare("SELECT * FROM influencers WHERE handle = ?").get(handle) as Row | undefined;
    if (!inf) throw new HttpError(404, `@${handle} 인플루언서를 찾을 수 없어요.`);
    if (!accountsOf(inf.address).length) throw new HttpError(409, "SNS 계정 인증을 마친 인플루언서만 태그할 수 있어요.");

    db.prepare(
      `INSERT INTO group_tags (group_id, influencer, seller, status, created_at) VALUES (?, ?, ?, 'pending', ?)
       ON CONFLICT(group_id, influencer) DO UPDATE SET status = 'pending', seller = excluded.seller`
    ).run(groupId, inf.address, req.address, Date.now());
    res.status(201).json({ groupId, handle, status: "pending" });
  })
);

/** 인플루언서가 태그를 수락·거절하거나, 수락했던 태그를 내린다 */
influencerRouter.post(
  "/tags/:groupId/respond",
  requireAuth,
  h((req, res) => {
    const { action } = parse(z.object({ action: z.enum(["accept", "reject", "remove"]) }), req.body);
    const status = { accept: "accepted", reject: "rejected", remove: "removed" }[action];
    const r = db
      .prepare("UPDATE group_tags SET status = ? WHERE group_id = ? AND influencer = ?")
      .run(status, Number(req.params.groupId), req.address);
    if (!r.changes) throw new HttpError(404, "받은 태그가 아니에요.");
    res.json({ groupId: Number(req.params.groupId), status });
  })
);

/** 공개된(수락된) 협찬 태그 전체 — 공구 카드·상세의 배지용 */
influencerRouter.get("/tags", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT t.group_id, i.handle, i.name, i.address FROM group_tags t JOIN influencers i ON i.address = t.influencer
       WHERE t.status = 'accepted' ORDER BY t.group_id`
    )
    .all() as Row[];
  res.json(
    rows.map((r) => ({ groupId: r.group_id, handle: r.handle, name: r.name, platforms: accountsOf(r.address).map((a) => a.label) }))
  );
});

// ─────────────── OAuth: SNS 계정 소유 확인 ───────────────

oauthRouter.get("/providers", (_req, res) => {
  res.json(PLATFORMS.map((p) => ({ platform: p, label: PROVIDERS[p].label, enabled: PROVIDERS[p].enabled() })).filter((p) => p.platform !== "mock" || p.enabled));
});

const STATE_TTL = 10 * 60 * 1000;

oauthRouter.post(
  "/:platform/start",
  requireAuth,
  h((req, res) => {
    const platform = req.params.platform as Platform;
    const provider = PROVIDERS[platform];
    if (!provider) throw new HttpError(404, "지원하지 않는 플랫폼이에요.");
    if (!provider.enabled()) throw new HttpError(503, `${provider.label} 연동이 아직 설정되지 않았어요.`);
    if (!myProfile(req.address)) throw new HttpError(409, "인플루언서 프로필을 먼저 만들어 주세요.");
    const state = crypto.randomBytes(16).toString("hex");
    const verifier = crypto.randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO oauth_states (state, address, platform, verifier, expires_at) VALUES (?, ?, ?, ?, ?)").run(
      state,
      req.address,
      platform,
      verifier,
      Date.now() + STATE_TTL
    );
    res.json({ url: provider.authorizeUrl(state, verifier) });
  })
);

const back = (params: Record<string, string>) => `${WEB_ORIGIN}/influencer?${new URLSearchParams(params)}`;

oauthRouter.get("/:platform/callback", async (req, res) => {
  const platform = req.params.platform as Platform;
  const state = String(req.query.state ?? "");
  const code = String(req.query.code ?? "");
  const row = db.prepare("SELECT * FROM oauth_states WHERE state = ? AND platform = ?").get(state, platform) as Row | undefined;
  db.prepare("DELETE FROM oauth_states WHERE state = ? OR expires_at < ?").run(state, Date.now()); // state는 한 번만
  if (!row || Number(row.expires_at) < Date.now()) return res.redirect(back({ error: "인증 요청이 만료됐어요. 다시 시도해 주세요." }));
  if (req.query.error || !code) return res.redirect(back({ error: "SNS 로그인을 취소했어요." }));

  try {
    const acc = await PROVIDERS[platform].exchange(code, String(row.verifier));
    const owner = db
      .prepare("SELECT address FROM influencer_accounts WHERE platform = ? AND platform_user_id = ?")
      .get(platform, acc.platformUserId) as Row | undefined;
    if (owner && owner.address !== row.address) return res.redirect(back({ error: "이 SNS 계정은 이미 다른 인플루언서에게 연결돼 있어요." }));
    db.prepare("DELETE FROM influencer_accounts WHERE address = ? AND platform = ?").run(row.address, platform); // 플랫폼당 한 계정
    db.prepare(
      "INSERT INTO influencer_accounts (platform, platform_user_id, address, username, url, verified_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(platform, acc.platformUserId, row.address, acc.username, acc.url, Date.now());
    res.redirect(back({ linked: platform }));
  } catch (e) {
    console.error(e);
    res.redirect(back({ error: e instanceof Error ? e.message : "계정 확인에 실패했어요." }));
  }
});

/** 개발용 가짜 SNS 로그인 화면 */
oauthRouter.get("/mock/authorize", (req, res) => {
  if (!PROVIDERS.mock.enabled()) return res.status(404).end();
  const state = String(req.query.state ?? "").replace(/[^a-f0-9]/g, "");
  res.type("html").send(`<!doctype html><meta charset="utf-8"><title>테스트 SNS 로그인</title>
<body style="font-family:sans-serif;max-width:360px;margin:80px auto">
<h2>테스트 SNS 로그인</h2><p style="color:#666">개발용 화면이에요. 실제 SNS 대신 사용자명을 입력해 계정 소유 확인을 흉내 내요.</p>
<form action="/oauth/mock/callback" method="get">
<input type="hidden" name="state" value="${state}">
<input name="code" placeholder="사용자명 (예: coffee_lover)" required style="width:100%;padding:10px;margin:8px 0">
<button style="width:100%;padding:10px">이 계정으로 로그인</button></form></body>`);
});
