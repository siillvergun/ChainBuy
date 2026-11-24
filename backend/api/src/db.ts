import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { CATALOG_PATH, DB_PATH } from "./config.js";

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS nonces (
  address TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 판매자 신청·입점 (SEL-01~03)
CREATE TABLE IF NOT EXISTS sellers (
  id TEXT PRIMARY KEY,              -- seller:xxxx (컨트랙트 sellerId = keccak256(id))
  address TEXT NOT NULL UNIQUE,     -- 정산 지갑 = 신청한 지갑
  name TEXT NOT NULL,
  biz_no TEXT NOT NULL,
  contact TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  reject_reason TEXT,
  created_at INTEGER NOT NULL
);

-- 상품 정보 (체인에는 productHash = keccak256(id) 만 올라간다)
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,              -- product:xxxx
  kind TEXT NOT NULL,               -- listed | external
  seller_id TEXT,                   -- listed 일 때
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  option TEXT NOT NULL,
  original_price INTEGER NOT NULL,
  price INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT,                         -- external 일 때 원본 링크
  tint TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 외부 상품 공구 제안 (GB-02, LNK)
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  proposer TEXT NOT NULL,
  product_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  max_price INTEGER NOT NULL,
  target_qty INTEGER NOT NULL,
  max_per_user INTEGER NOT NULL,
  days INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  reject_reason TEXT,
  group_id INTEGER,
  created_at INTEGER NOT NULL
);
`);

// 인플루언서 프로필과 OAuth로 확인한 SNS 계정, 공구 협찬 태그
db.exec(`
CREATE TABLE IF NOT EXISTS influencers (
  address TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS influencer_accounts (
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  address TEXT NOT NULL,
  username TEXT NOT NULL,
  url TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  PRIMARY KEY (platform, platform_user_id)       -- SNS 계정 하나는 인플루언서 한 명에게만
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  platform TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS group_tags (
  group_id INTEGER NOT NULL,
  influencer TEXT NOT NULL,                       -- 인플루언서 지갑 주소
  seller TEXT NOT NULL,                           -- 태그한 판매자 지갑
  status TEXT NOT NULL DEFAULT 'pending',         -- pending | accepted | rejected | removed
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, influencer)
);
`);

/** 데모 상품(catalog.json)을 처음 한 번 넣는다. 로컬 시드 공구가 이 상품들을 가리킨다. */
export function seedCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) return;
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const insertSeller = db.prepare(
    `INSERT OR IGNORE INTO sellers (id, address, name, biz_no, contact, status, created_at)
     VALUES (@id, @address, @name, '000-00-00000', 'demo@chainbuy.local', 'approved', @now)`
  );
  const insertProduct = db.prepare(
    `INSERT OR IGNORE INTO products (id, kind, seller_id, name, category, option, original_price, price, tint, created_at)
     VALUES (@id, 'listed', @seller, @name, @category, @option, @originalPrice, @price, @tint, @now)`
  );
  const now = Date.now();
  // 데모 판매자 지갑은 hardhat 계정 #4 (blockchain/scripts/deploy.ts 와 같다)
  for (const s of catalog.sellers) {
    insertSeller.run({ id: s.id, address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", name: s.name, now });
  }
  for (const p of catalog.products) insertProduct.run({ ...p, now });
}
