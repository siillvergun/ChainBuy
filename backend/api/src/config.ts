import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..", "..");

export const PORT = Number(process.env.PORT ?? 4000);
export const DB_PATH = process.env.DB_PATH ?? path.join(here, "..", "data", "chainbuy.db");
export const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

/** 컨트랙트 주소: 환경 변수 → 없으면 blockchain/deployments/localhost.json */
function loadDeployment() {
  const file = path.join(root, "blockchain", "deployments", "localhost.json");
  const local = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  return {
    chainBuy: (process.env.CHAINBUY_ADDRESS ?? local?.ChainBuy) as `0x${string}` | undefined,
  };
}
export const deployment = loadDeployment();

export const chainBuyAbi = JSON.parse(
  fs.readFileSync(path.join(root, "blockchain", "artifacts", "contracts", "ChainBuy.sol", "ChainBuy.json"), "utf8")
).abi;

export const CATALOG_PATH = path.join(root, "frontend", "src", "lib", "catalog.json");

/** 허용 쇼핑몰: 도메인 → 컨트랙트 merchantId (데모에서는 모두 demo-mall 한 곳으로 연결) */
export const ALLOWED_MALLS: Record<string, string> = {
  "coupang.com": "merchant:demo-mall",
  "smartstore.naver.com": "merchant:demo-mall",
  "11st.co.kr": "merchant:demo-mall",
};

export const CATEGORIES = [
  "디지털", "가전", "식품", "음료", "캠핑", "생활", "주방", "육아", "뷰티", "반려동물", "스포츠", "패션", "건강", "문구",
];

/** OAuth 콜백을 받을 이 API의 공개 주소 (각 플랫폼 앱 설정의 Redirect URI = `${API_PUBLIC_URL}/oauth/<platform>/callback`) */
export const API_PUBLIC_URL = process.env.API_PUBLIC_URL ?? `http://localhost:${PORT}`;
/** 개발용 가짜 OAuth (실제 앱 키 없이 흐름 테스트). 배포 환경에서는 꺼진다. */
export const ENABLE_MOCK_OAUTH = process.env.ENABLE_MOCK_OAUTH ? process.env.ENABLE_MOCK_OAUTH === "1" : process.env.NODE_ENV !== "production";
