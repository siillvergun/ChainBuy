import express from "express";
import { db } from "./db.js";
import { HttpError, requireAuth } from "./auth.js";
import { onchainGroup } from "./chain.js";
import { h } from "./http.js";

/**
 * 찜: 참여(예치)하기 전에 관심 있는 공구를 담아 둔다. 지갑(로그인 계정)별로 저장.
 * 장바구니(이미 예치한 공구)와 달리 돈과 무관해서 체인에 올리지 않는다.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS likes (
  address TEXT NOT NULL,
  group_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (address, group_id)
);
CREATE INDEX IF NOT EXISTS likes_group ON likes (group_id);
`);

export const likesRouter = express.Router();

const groupId = (raw: string) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "공구 번호가 올바르지 않아요.");
  return id;
};

/** 내가 찜한 공구 id (최근 찜한 순) */
likesRouter.get(
  "/likes",
  requireAuth,
  h((req, res) => {
    const rows = db.prepare("SELECT group_id FROM likes WHERE address = ? ORDER BY created_at DESC").all(req.address) as { group_id: number }[];
    res.json(rows.map((r) => r.group_id));
  })
);

/** 공구별 찜 수 */
likesRouter.get("/likes/counts", (_req, res) => {
  const rows = db.prepare("SELECT group_id, COUNT(*) AS n FROM likes GROUP BY group_id").all() as { group_id: number; n: number }[];
  res.json(Object.fromEntries(rows.map((r) => [r.group_id, r.n])));
});

likesRouter.post(
  "/likes/:groupId",
  requireAuth,
  h(async (req, res) => {
    const id = groupId(String(req.params.groupId));
    // 체인에 없는 공구 번호는 찜할 수 없다
    const g = await onchainGroup(BigInt(id)).catch(() => null);
    if (!g || g.targetQty === 0) throw new HttpError(404, "공구를 찾을 수 없어요.");
    db.prepare("INSERT OR IGNORE INTO likes (address, group_id, created_at) VALUES (?, ?, ?)").run(req.address, id, Date.now());
    res.status(201).json({ groupId: id, liked: true });
  })
);

likesRouter.delete(
  "/likes/:groupId",
  requireAuth,
  h((req, res) => {
    const id = groupId(String(req.params.groupId));
    db.prepare("DELETE FROM likes WHERE address = ? AND group_id = ?").run(req.address, id);
    res.json({ groupId: id, liked: false });
  })
);
