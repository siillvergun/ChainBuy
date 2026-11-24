import crypto from "crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { z } from "zod";
import { ALLOWED_MALLS, CATEGORIES, PORT, WEB_ORIGIN } from "./config.js";
import { db, seedCatalog } from "./db.js";
import { HttpError, issueNonce, requireAuth, requireReviewer, verifyLogin } from "./auth.js";
import { idHash, onchainGroup, onchainSeller } from "./chain.js";

seedCatalog();

const app = express();
app.use(cors({ origin: WEB_ORIGIN }));
app.use(express.json({ limit: "100kb" }));

const shortId = () => crypto.randomBytes(6).toString("hex");
const TINTS = ["#EEF2F7", "#F1E8DC", "#E7EEE6", "#F2F4EE", "#EEF5F3", "#F4F1EC", "#F3ECE4", "#EDEBE3"];
const tint = () => TINTS[Math.floor(Math.random() * TINTS.length)];

/** async 라우트 에러를 에러 핸들러로 넘긴다 */
const h =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
  return r.data;
};

// ─────────────── 공통 ───────────────

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/auth/nonce", h((req, res) => res.json(issueNonce(String(req.body?.address ?? "")))));

app.post(
  "/auth/verify",
  h(async (req, res) => {
    const { address, signature } = parse(
      z.object({ address: z.string(), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }),
      req.body
    );
    res.json(await verifyLogin(address, signature as `0x${string}`));
  })
);

/** 화면에 표시할 상품 정보. 공구(체인)는 productHash로 이 목록과 연결된다 */
app.get("/products", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, s.name AS seller_name FROM products p LEFT JOIN sellers s ON s.id = p.seller_id ORDER BY p.created_at DESC`
    )
    .all() as Record<string, unknown>[];
  res.json(rows.map(productOut));
});

function productOut(p: Record<string, unknown>) {
  return {
    id: p.id,
    productHash: idHash(String(p.id)),
    kind: p.kind,
    seller: p.seller_id,
    sellerName: p.seller_name ?? null,
    name: p.name,
    category: p.category,
    option: p.option,
    originalPrice: p.original_price,
    price: p.price,
    description: p.description,
    url: p.url ?? null,
    tint: p.tint,
  };
}

// ─────────────── 판매자 (SEL) ───────────────

app.post(
  "/sellers",
  requireAuth,
  h((req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(40),
        bizNo: z.string().trim().regex(/^\d{3}-\d{2}-\d{5}$/, "사업자등록번호 형식은 000-00-00000"),
        contact: z.string().trim().min(5).max(80),
      }),
      req.body
    );
    const exists = db.prepare("SELECT status FROM sellers WHERE address = ?").get(req.address) as { status: string } | undefined;
    if (exists && exists.status !== "rejected") throw new HttpError(409, "이미 신청한 지갑이에요.");
    if (exists) db.prepare("DELETE FROM sellers WHERE address = ?").run(req.address);
    const id = `seller:${shortId()}`;
    db.prepare(
      "INSERT INTO sellers (id, address, name, biz_no, contact, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)"
    ).run(id, req.address, body.name, body.bizNo, body.contact, Date.now());
    res.status(201).json(sellerOut(db.prepare("SELECT * FROM sellers WHERE id = ?").get(id) as Record<string, unknown>));
  })
);

app.get(
  "/sellers/me",
  requireAuth,
  h((req, res) => {
    const row = db.prepare("SELECT * FROM sellers WHERE address = ?").get(req.address) as Record<string, unknown> | undefined;
    res.json(row ? sellerOut(row) : null);
  })
);

function sellerOut(s: Record<string, unknown>) {
  return {
    id: s.id,
    sellerIdHash: idHash(String(s.id)),
    address: s.address,
    name: s.name,
    bizNo: s.biz_no,
    contact: s.contact,
    status: s.status,
    rejectReason: s.reject_reason ?? null,
    createdAt: s.created_at,
  };
}

function approvedSeller(address?: string) {
  const s = db.prepare("SELECT * FROM sellers WHERE address = ?").get(address) as Record<string, unknown> | undefined;
  if (!s || s.status !== "approved") throw new HttpError(403, "승인된 판매자만 할 수 있어요.");
  return s;
}

/** 판매자 상품 등록 (SEL-05) */
app.post(
  "/products",
  requireAuth,
  h((req, res) => {
    const seller = approvedSeller(req.address);
    const body = parse(
      z
        .object({
          name: z.string().trim().min(2).max(60),
          category: z.enum(CATEGORIES as [string, ...string[]]),
          option: z.string().trim().min(1).max(40),
          originalPrice: z.number().int().positive(),
          price: z.number().int().positive(),
          description: z.string().trim().max(1000).default(""),
        })
        .refine((b) => b.price <= b.originalPrice, { message: "공구가는 정가보다 클 수 없어요.", path: ["price"] }),
      req.body
    );
    const id = `product:${shortId()}`;
    db.prepare(
      `INSERT INTO products (id, kind, seller_id, name, category, option, original_price, price, description, tint, created_at)
       VALUES (?, 'listed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, seller.id, body.name, body.category, body.option, body.originalPrice, body.price, body.description, tint(), Date.now());
    res.status(201).json(productOut(db.prepare("SELECT * FROM products WHERE id = ?").get(id) as Record<string, unknown>));
  })
);

app.get(
  "/products/mine",
  requireAuth,
  h((req, res) => {
    const seller = approvedSeller(req.address);
    const rows = db.prepare("SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC").all(seller.id) as Record<
      string,
      unknown
    >[];
    res.json(rows.map(productOut));
  })
);

// ─────────────── 외부 상품 제안 (GB-02, LNK-01·02) ───────────────

export function checkMallUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "링크 형식이 올바르지 않아요.");
  }
  if (u.protocol !== "https:") throw new HttpError(400, "https 링크만 받아요.");
  const host = u.hostname.replace(/^www\./, "");
  const mall = Object.keys(ALLOWED_MALLS).find((d) => host === d || host.endsWith(`.${d}`));
  if (!mall) throw new HttpError(400, "허용된 쇼핑몰 링크가 아니에요. (쿠팡, 네이버 스마트스토어, 11번가)");
  return { url: u.toString(), merchantId: ALLOWED_MALLS[mall], mall };
}

app.post(
  "/proposals",
  requireAuth,
  h((req, res) => {
    const body = parse(
      z
        .object({
          url: z.string(),
          name: z.string().trim().min(2).max(60),
          category: z.enum(CATEGORIES as [string, ...string[]]),
          option: z.string().trim().min(1).max(40),
          currentPrice: z.number().int().positive(),
          maxPrice: z.number().int().positive(),
          targetQty: z.number().int().min(2).max(1000),
          maxPerUser: z.number().int().min(1),
          days: z.number().int().min(1).max(30),
          reason: z.string().trim().max(300).default(""),
        })
        .refine((b) => b.maxPerUser <= b.targetQty, { message: "1인 최대는 목표 수량 이하", path: ["maxPerUser"] })
        .refine((b) => b.maxPrice >= b.currentPrice, { message: "최대 가격은 현재 가격 이상", path: ["maxPrice"] }),
      req.body
    );
    const { url, merchantId } = checkMallUrl(body.url);
    const productId = `product:${shortId()}`;
    const id = `prop_${shortId()}`;
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO products (id, kind, name, category, option, original_price, price, description, url, tint, created_at)
         VALUES (?, 'external', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(productId, body.name, body.category, body.option, body.currentPrice, body.maxPrice, body.reason, url, tint(), Date.now());
      db.prepare(
        `INSERT INTO proposals (id, proposer, product_id, merchant_id, max_price, target_qty, max_per_user, days, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, req.address, productId, merchantId, body.maxPrice, body.targetQty, body.maxPerUser, body.days, body.reason, Date.now());
    });
    tx();
    res.status(201).json(proposalOut(proposalRow(id)));
  })
);

app.get(
  "/proposals/mine",
  requireAuth,
  h((req, res) => {
    const rows = db
      .prepare(`${PROPOSAL_SELECT} WHERE pr.proposer = ? ORDER BY pr.created_at DESC`)
      .all(req.address) as Record<string, unknown>[];
    res.json(rows.map(proposalOut));
  })
);

const PROPOSAL_SELECT = `SELECT pr.*, p.name, p.category, p.option, p.original_price AS current_price, p.url
  FROM proposals pr JOIN products p ON p.id = pr.product_id`;
const proposalRow = (id: string) => db.prepare(`${PROPOSAL_SELECT} WHERE pr.id = ?`).get(id) as Record<string, unknown>;

function proposalOut(p: Record<string, unknown>) {
  return {
    id: p.id,
    proposer: p.proposer,
    productId: p.product_id,
    productHash: idHash(String(p.product_id)),
    merchantId: p.merchant_id,
    merchantIdHash: idHash(String(p.merchant_id)),
    name: p.name,
    category: p.category,
    option: p.option,
    url: p.url,
    currentPrice: p.current_price,
    maxPrice: p.max_price,
    targetQty: p.target_qty,
    maxPerUser: p.max_per_user,
    days: p.days,
    reason: p.reason,
    status: p.status,
    rejectReason: p.reject_reason ?? null,
    groupId: p.group_id ?? null,
    createdAt: p.created_at,
  };
}

// ─────────────── 담당자 (ADM) ───────────────
// 체인 기록(판매자 등록, 외부 공구 생성)은 담당자가 자기 지갑으로 직접 보내고,
// 서버는 체인을 읽어 실제로 기록됐는지 확인한 뒤에만 상태를 바꾼다.

const admin = express.Router();
admin.use(requireAuth, requireReviewer);

admin.get("/sellers", (_req, res) => {
  const rows = db.prepare("SELECT * FROM sellers ORDER BY status = 'pending' DESC, created_at DESC").all() as Record<string, unknown>[];
  res.json(rows.map(sellerOut));
});

admin.post(
  "/sellers/:id/approve",
  h(async (req, res) => {
    const s = db.prepare("SELECT * FROM sellers WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
    if (!s) throw new HttpError(404, "신청을 찾을 수 없어요.");
    const chain = await onchainSeller(String(s.id));
    if (!chain.active || chain.wallet.toLowerCase() !== String(s.address).toLowerCase()) {
      throw new HttpError(409, "컨트랙트에 판매자 지갑이 아직 등록되지 않았어요. setSeller 트랜잭션을 먼저 보내 주세요.");
    }
    db.prepare("UPDATE sellers SET status = 'approved', reject_reason = NULL WHERE id = ?").run(s.id);
    res.json(sellerOut(db.prepare("SELECT * FROM sellers WHERE id = ?").get(s.id) as Record<string, unknown>));
  })
);

admin.post(
  "/sellers/:id/reject",
  h((req, res) => {
    const reason = parse(z.object({ reason: z.string().trim().min(1).max(200) }), req.body).reason;
    const r = db.prepare("UPDATE sellers SET status = 'rejected', reject_reason = ? WHERE id = ? AND status = 'pending'").run(reason, req.params.id);
    if (!r.changes) throw new HttpError(404, "대기 중인 신청이 아니에요.");
    res.json({ ok: true });
  })
);

admin.get("/proposals", (_req, res) => {
  const rows = db.prepare(`${PROPOSAL_SELECT} ORDER BY pr.status = 'pending' DESC, pr.created_at DESC`).all() as Record<string, unknown>[];
  res.json(rows.map(proposalOut));
});

admin.post(
  "/proposals/:id/approve",
  h(async (req, res) => {
    const { groupId } = parse(z.object({ groupId: z.number().int().positive() }), req.body);
    const p = proposalRow(String(req.params.id));
    if (!p || p.status !== "pending") throw new HttpError(404, "대기 중인 제안이 아니에요.");
    const g = await onchainGroup(BigInt(groupId));
    const ok =
      g.kind === 1 &&
      g.productHash === idHash(String(p.product_id)) &&
      g.partyId === idHash(String(p.merchant_id)) &&
      g.creator.toLowerCase() === String(p.proposer).toLowerCase();
    if (!ok) throw new HttpError(409, "체인의 공구가 이 제안과 맞지 않아요. createExternalGroup 을 먼저 보내 주세요.");
    db.prepare("UPDATE proposals SET status = 'approved', group_id = ? WHERE id = ?").run(groupId, p.id);
    res.json(proposalOut(proposalRow(String(p.id))));
  })
);

admin.post(
  "/proposals/:id/reject",
  h((req, res) => {
    const reason = parse(z.object({ reason: z.string().trim().min(1).max(200) }), req.body).reason;
    const r = db.prepare("UPDATE proposals SET status = 'rejected', reject_reason = ? WHERE id = ? AND status = 'pending'").run(reason, req.params.id);
    if (!r.changes) throw new HttpError(404, "대기 중인 제안이 아니에요.");
    res.json({ ok: true });
  })
);

app.use("/admin", admin);

// ─────────────── 에러 ───────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "서버 오류가 발생했어요." });
});

app.listen(PORT, () => console.log(`ChainBuy API on http://localhost:${PORT}`));
