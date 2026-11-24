import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { getAddress, isAddress, verifyMessage } from "viem";
import { db } from "./db.js";
import { isReviewer } from "./chain.js";

/**
 * 지갑 서명 로그인 (Sign-In with Ethereum 방식)
 * 1) POST /auth/nonce {address} → 서명할 문구
 * 2) 지갑으로 문구에 서명 → POST /auth/verify {address, signature} → 세션 토큰
 * 이후 요청은 Authorization: Bearer <token>
 */
const NONCE_TTL = 5 * 60 * 1000;
const SESSION_TTL = 12 * 60 * 60 * 1000;

export const loginMessage = (address: string, nonce: string) =>
  `ChainBuy에 로그인합니다.\n\n지갑: ${address}\nnonce: ${nonce}\n\n이 서명은 거래가 아니며 수수료가 들지 않습니다.`;

export function issueNonce(raw: string) {
  if (!isAddress(raw)) throw new HttpError(400, "지갑 주소가 올바르지 않아요.");
  const address = getAddress(raw);
  const nonce = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT OR REPLACE INTO nonces (address, nonce, expires_at) VALUES (?, ?, ?)").run(
    address,
    nonce,
    Date.now() + NONCE_TTL
  );
  return { address, message: loginMessage(address, nonce) };
}

export async function verifyLogin(raw: string, signature: `0x${string}`) {
  if (!isAddress(raw)) throw new HttpError(400, "지갑 주소가 올바르지 않아요.");
  const address = getAddress(raw);
  const row = db.prepare("SELECT nonce, expires_at FROM nonces WHERE address = ?").get(address) as
    | { nonce: string; expires_at: number }
    | undefined;
  if (!row || row.expires_at < Date.now()) throw new HttpError(401, "로그인 요청이 만료됐어요. 다시 시도해 주세요.");
  const ok = await verifyMessage({ address, message: loginMessage(address, row.nonce), signature });
  if (!ok) throw new HttpError(401, "서명이 지갑 주소와 맞지 않아요.");
  db.prepare("DELETE FROM nonces WHERE address = ?").run(address); // 같은 서명 재사용 방지
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, address, expires_at) VALUES (?, ?, ?)").run(token, address, Date.now() + SESSION_TTL);
  return { token, address, isReviewer: await isReviewer(address).catch(() => false) };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

declare module "express-serve-static-core" {
  interface Request {
    address?: `0x${string}`;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  const row = token
    ? (db.prepare("SELECT address, expires_at FROM sessions WHERE token = ?").get(token) as
        | { address: `0x${string}`; expires_at: number }
        | undefined)
    : undefined;
  if (!row || row.expires_at < Date.now()) return next(new HttpError(401, "지갑으로 로그인해 주세요."));
  req.address = row.address;
  next();
}

export async function requireReviewer(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.address || !(await isReviewer(req.address))) throw new HttpError(403, "담당자만 할 수 있어요.");
    next();
  } catch (e) {
    next(e);
  }
}
