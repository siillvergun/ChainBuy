import crypto from "crypto";
import express from "express";
import { keccak256, toBytes } from "viem";
import { z } from "zod";
import { db } from "./db.js";
import { HttpError, requireAuth } from "./auth.js";
import { h, parse } from "./http.js";

/**
 * 사용자 프로필 (닉네임·연락처·배송지)
 * 배송지 원문은 서버에만 두고, 체인에는 "솔트 + 배송지"의 해시(recipientHash)만 올린다 (DEP-04, NFR-03).
 * 솔트가 있어서 주소를 추측해 해시를 맞춰 보는 공격이 어렵다.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  address TEXT PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  ship_name TEXT,
  ship_phone TEXT,
  ship_zip TEXT,
  ship_addr1 TEXT,
  ship_addr2 TEXT,
  salt TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

export const usersRouter = express.Router();
type Row = Record<string, unknown>;

function recipientHash(u: Row): `0x${string}` | null {
  if (!u.ship_name || !u.ship_addr1) return null;
  return keccak256(toBytes([u.salt, u.ship_name, u.ship_phone, u.ship_zip, u.ship_addr1, u.ship_addr2 ?? ""].join("|")));
}

function userOut(address: string, u?: Row) {
  return {
    address,
    nickname: (u?.nickname as string) ?? "",
    contact: (u?.contact as string) ?? "",
    shipping: u?.ship_name
      ? { name: u.ship_name, phone: u.ship_phone, zip: u.ship_zip, address1: u.ship_addr1, address2: u.ship_addr2 ?? "" }
      : null,
    recipientHash: u ? recipientHash(u) : null,
  };
}

usersRouter.get(
  "/users/me",
  requireAuth,
  h((req, res) => {
    const u = db.prepare("SELECT * FROM users WHERE address = ?").get(req.address) as Row | undefined;
    res.json(userOut(req.address!, u));
  })
);

usersRouter.put(
  "/users/me",
  requireAuth,
  h((req, res) => {
    const body = parse(
      z.object({
        nickname: z.string().trim().max(20).default(""),
        contact: z.string().trim().max(80).default(""),
        shipping: z
          .object({
            name: z.string().trim().min(1, "받는 분 이름을 적어 주세요").max(20),
            phone: z.string().trim().regex(/^[0-9-]{9,14}$/, "전화번호 형식이 올바르지 않아요"),
            zip: z.string().trim().regex(/^\d{5}$/, "우편번호는 숫자 5자리"),
            address1: z.string().trim().min(5, "주소를 적어 주세요").max(100),
            address2: z.string().trim().max(60).default(""),
          })
          .nullable()
          .default(null),
      }),
      req.body
    );
    const prev = db.prepare("SELECT salt FROM users WHERE address = ?").get(req.address) as Row | undefined;
    const salt = (prev?.salt as string) ?? crypto.randomBytes(16).toString("hex");
    const s = body.shipping;
    db.prepare(
      `INSERT INTO users (address, nickname, contact, ship_name, ship_phone, ship_zip, ship_addr1, ship_addr2, salt, updated_at)
       VALUES (@address, @nickname, @contact, @name, @phone, @zip, @a1, @a2, @salt, @now)
       ON CONFLICT(address) DO UPDATE SET nickname = @nickname, contact = @contact, ship_name = @name, ship_phone = @phone,
         ship_zip = @zip, ship_addr1 = @a1, ship_addr2 = @a2, updated_at = @now`
    ).run({
      address: req.address,
      nickname: body.nickname,
      contact: body.contact,
      name: s?.name ?? null,
      phone: s?.phone ?? null,
      zip: s?.zip ?? null,
      a1: s?.address1 ?? null,
      a2: s?.address2 ?? null,
      salt,
      now: Date.now(),
    });
    res.json(userOut(req.address!, db.prepare("SELECT * FROM users WHERE address = ?").get(req.address) as Row));
  })
);

/** 판매자 정보 수정: 상호·연락처만 (사업자등록번호와 정산 지갑은 바꿀 수 없음) */
usersRouter.patch(
  "/sellers/me",
  requireAuth,
  h((req, res) => {
    const body = parse(
      z.object({ name: z.string().trim().min(2).max(40), contact: z.string().trim().min(5).max(80) }),
      req.body
    );
    const r = db.prepare("UPDATE sellers SET name = ?, contact = ? WHERE address = ? AND status != 'rejected'").run(body.name, body.contact, req.address);
    if (!r.changes) throw new HttpError(404, "판매자 신청 내역이 없어요.");
    const s = db.prepare("SELECT id, name, contact, status FROM sellers WHERE address = ?").get(req.address);
    res.json(s);
  })
);
