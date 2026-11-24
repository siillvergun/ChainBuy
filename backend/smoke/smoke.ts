/**
 * API + 컨트랙트 전체 흐름 확인 (로컬 체인·API가 켜져 있어야 함)
 *   판매자 신청 → 담당자 체인 등록 → 승인 → 상품 등록 → 판매자가 공구 열기
 *   일반 사용자 외부 상품 제안 → 담당자 체인 생성 → 승인
 * hardhat 기본 테스트 계정 키만 쓴다 (테스트 전용, 실제 자금 없음).
 */
import { createWalletClient, http, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { chainBuyAbi, client, deployment } from "./config.js";


const API = process.env.API ?? "http://localhost:4000";
const KEYS = {
  reviewer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // #1 (REVIEWER)
  newSeller: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e", // #6
  proposer: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356", // #7
  influencer: "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6", // #8
  impostor: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97", // #9
} as const;

/** mock OAuth로 SNS 계정을 연결한다. 리다이렉트 Location을 돌려준다 */
async function linkMock(token: string, username: string) {
  const start = await api("/oauth/mock/start", { token, body: {} });
  if (start.status !== 200) return { location: `start ${start.status} ${start.data?.error}`, state: "" };
  const state = new URL(start.data.url).searchParams.get("state")!;
  const res = await fetch(`${API}/oauth/mock/callback?state=${state}&code=${username}`, { redirect: "manual" });
  // 리다이렉트 주소의 쿼리(공백은 +로 인코딩됨)를 제대로 풀어서 비교한다
  const loc = new URL(res.headers.get("location") ?? "http://x/");
  return { location: `${loc.pathname}?linked=${loc.searchParams.get("linked") ?? ""}&error=${loc.searchParams.get("error") ?? ""}`, state };
}

const cb = { address: deployment.chainBuy!, abi: chainBuyAbi } as const;
let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
};

function wallet(key: Hex) {
  const account = privateKeyToAccount(key);
  return createWalletClient({ account, chain: hardhat, transport: http("http://127.0.0.1:8545") });
}

async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function login(key: Hex) {
  const w = wallet(key);
  const { data } = await api("/auth/nonce", { body: { address: w.account.address } });
  const signature = await w.signMessage({ message: data.message });
  const r = await api("/auth/verify", { body: { address: w.account.address, signature } });
  return { ...r.data, w } as { token: string; address: string; isReviewer: boolean; w: ReturnType<typeof wallet> };
}

async function send(w: ReturnType<typeof wallet>, functionName: string, args: unknown[]) {
  const hash = await w.writeContract({ ...cb, functionName, args } as never);
  return client.waitForTransactionReceipt({ hash });
}

const days = (n: number) => BigInt(Math.floor(Date.now() / 1000) + n * 86400);

async function main() {
  const reviewer = await login(KEYS.reviewer);
  const seller = await login(KEYS.newSeller);
  const proposer = await login(KEYS.proposer);
  check("지갑 서명 로그인", !!seller.token && reviewer.isReviewer && !seller.isReviewer);
  let r0 = await api("/auth/me", { token: seller.token });
  check("로그인 응답에 만료 시각, /auth/me로 토큰 확인", r0.status === 200 && r0.data.address === seller.address && r0.data.expiresAt > Date.now());
  r0 = await api("/auth/me", { token: "invalid-token" });
  check("무효 토큰은 401 + 만료 안내", r0.status === 401 && String(r0.data?.error).includes("만료"));
  r0 = await api("/auth/me");
  check("토큰 없이 요청하면 401 + 로그인 안내", r0.status === 401 && String(r0.data?.error).includes("로그인해"));

  // ── 판매자 플로우 ──
  let r = await api("/sellers", { token: seller.token, body: { name: "오늘의 커피", bizNo: "123-45-67890", contact: "010-1234-5678" } });
  check("판매자 신청 → 대기", r.status === 201 && r.data.status === "pending", `${r.status}`);
  const sellerId = r.data.id as string;

  r = await api("/products", { token: seller.token, body: { name: "x", category: "식품", option: "1", originalPrice: 1, price: 1 } });
  check("승인 전에는 상품 등록 불가", r.status === 403);

  r = await api("/admin/sellers", { token: proposer.token });
  check("담당자가 아니면 관리 목록 접근 불가", r.status === 403);

  r = await api(`/admin/sellers/${sellerId}/approve`, { token: reviewer.token, body: {} });
  check("체인 등록 전에는 승인 불가", r.status === 409);

  await send(reviewer.w, "setSeller", [keccak256(toBytes(sellerId)), seller.address, true]);
  r = await api(`/admin/sellers/${sellerId}/approve`, { token: reviewer.token, body: {} });
  check("체인 등록 후 승인", r.status === 200 && r.data.status === "approved", `${r.status}`);

  r = await api("/products", {
    token: seller.token,
    body: { name: "콜롬비아 수프리모 원두 1kg", category: "식품", option: "홀빈 · 1kg", originalPrice: 30000, price: 23900, description: "로스팅 후 3일 이내 발송" },
  });
  check("판매자 상품 등록", r.status === 201, `${r.status} ${JSON.stringify(r.data)}`);
  const product = r.data;

  const params = (price: number, target: number, perUser: number, d: number, productHash: Hex) => ({
    productHash,
    maxPrice: BigInt(price) * 1_000_000n,
    targetQty: target,
    maxPerUser: perUser,
    deadline: days(d),
  });
  const rc = await send(seller.w, "createListedGroup", [keccak256(toBytes(sellerId)), params(23900, 20, 2, 3, product.productHash)]);
  const listedId = (await client.readContract({ ...cb, functionName: "groupCount", args: [] })) as bigint;
  const g = (await client.readContract({ ...cb, functionName: "getGroup", args: [listedId] })) as { creator: string; payee: string; productHash: string };
  check("판매자 지갑으로 공구 열기", rc.status === "success" && g.payee === seller.address && g.productHash === product.productHash, `#${listedId}`);

  let reverted = false;
  try {
    await send(proposer.w, "createListedGroup", [keccak256(toBytes(sellerId)), params(23900, 20, 2, 3, product.productHash)]);
  } catch {
    reverted = true;
  }
  check("다른 사람은 판매자 상품으로 공구를 열 수 없음", reverted);

  // ── 외부 상품 제안 플로우 ──
  const proposal = {
    url: "https://www.coupang.com/vp/products/123456",
    name: "대용량 세탁 세제 4L 4개",
    category: "생활",
    option: "무향 · 4개",
    currentPrice: 32900,
    maxPrice: 34900,
    targetQty: 10,
    maxPerUser: 2,
    days: 5,
    reason: "매달 쓰는 세제라 같이 사면 좋을 것 같아요",
  };
  r = await api("/proposals", { token: proposer.token, body: { ...proposal, url: "https://evil-mall.com/item/1" } });
  check("허용되지 않은 쇼핑몰 링크 거부", r.status === 400, r.data?.error);
  r = await api("/proposals", { token: proposer.token, body: { ...proposal, url: "http://www.coupang.com/vp/products/1" } });
  check("https 아닌 링크 거부", r.status === 400);
  r = await api("/proposals", { token: proposer.token, body: proposal });
  check("외부 상품 제안 → 대기", r.status === 201 && r.data.status === "pending", `${r.status}`);
  const prop = r.data;

  r = await api(`/admin/proposals/${prop.id}/approve`, { token: reviewer.token, body: { groupId: Number(listedId) } });
  check("체인 공구와 맞지 않으면 승인 불가", r.status === 409);

  await send(reviewer.w, "createExternalGroup", [prop.merchantIdHash, proposer.address, params(prop.maxPrice, prop.targetQty, prop.maxPerUser, prop.days, prop.productHash)]);
  const extId = (await client.readContract({ ...cb, functionName: "groupCount", args: [] })) as bigint;
  r = await api(`/admin/proposals/${prop.id}/approve`, { token: reviewer.token, body: { groupId: Number(extId) } });
  check("체인 생성 후 제안 승인", r.status === 200 && r.data.groupId === Number(extId), `#${extId}`);

  r = await api("/proposals/mine", { token: proposer.token });
  check("내 제안 목록", r.status === 200 && r.data[0]?.status === "approved");

  r = await api("/products");
  const hashes = new Set((r.data as { productHash: string }[]).map((p) => p.productHash));
  check("상품 목록에 새 상품 포함", hashes.has(product.productHash) && hashes.has(prop.productHash));

  // ── 인플루언서 인증·협찬 태그 플로우 ──
  const inf = await login(KEYS.influencer);
  const impostor = await login(KEYS.impostor);

  r = await api("/oauth/mock/start", { token: inf.token, body: {} });
  check("프로필 없이 SNS 연결 불가", r.status === 409);

  r = await api("/influencers", { token: inf.token, body: { handle: "Coffee_Lover", name: "커피러버", bio: "매일 커피 리뷰" } });
  check("인플루언서 프로필 생성 (핸들 소문자화)", r.status === 200 && r.data.handle === "coffee_lover" && !r.data.verified);

  r = await api("/influencers", { token: impostor.token, body: { handle: "coffee_lover", name: "가짜" } });
  check("이미 쓰는 핸들은 가져갈 수 없음", r.status === 409);

  r = await api(`/groups/${listedId}/tags`, { token: seller.token, body: { handle: "@coffee_lover" } });
  check("SNS 인증 전에는 태그 불가", r.status === 409);

  r = await api("/providers".replace("/", "/oauth/"));
  check("OAuth 제공자 목록에 4개 플랫폼 + 테스트", r.status === 200 && ["youtube", "instagram", "threads", "tiktok"].every((p) => r.data.some((x: { platform: string }) => x.platform === p)));

  const linked = await linkMock(inf.token, "coffee_lover");
  check("SNS 계정 연결 (mock OAuth)", linked.location.includes("linked=mock&error="), linked.location);
  const replay = await fetch(`${API}/oauth/mock/callback?state=${linked.state}&code=coffee_lover`, { redirect: "manual" });
  check("같은 인증 요청(state) 재사용 불가", decodeURIComponent(replay.headers.get("location") ?? "").includes("error="));

  await api("/influencers", { token: impostor.token, body: { handle: "fake_coffee", name: "가짜" } });
  const stolen = await linkMock(impostor.token, "coffee_lover");
  check("다른 사람이 연결한 SNS 계정은 가져갈 수 없음", stolen.location.includes("이미 다른"), stolen.location);

  r = await api(`/groups/${listedId}/tags`, { token: proposer.token, body: { handle: "coffee_lover" } });
  check("판매자가 아니면 태그 불가", r.status === 403);
  r = await api(`/groups/${extId}/tags`, { token: seller.token, body: { handle: "coffee_lover" } });
  check("남의 공구에는 태그 불가", r.status === 403);

  r = await api(`/groups/${listedId}/tags`, { token: seller.token, body: { handle: "@coffee_lover" } });
  check("판매자가 자기 공구에 태그 → 수락 대기", r.status === 201 && r.data.status === "pending");

  r = await api("/tags");
  check("수락 전에는 공개되지 않음", !r.data.some((t: { groupId: number }) => t.groupId === Number(listedId)));

  r = await api(`/tags/${listedId}/respond`, { token: inf.token, body: { action: "accept" } });
  check("인플루언서가 태그 수락", r.status === 200 && r.data.status === "accepted");
  r = await api("/tags");
  check("수락 후 협찬 태그 공개", r.data.some((t: { groupId: number; handle: string }) => t.groupId === Number(listedId) && t.handle === "coffee_lover"));
  r = await api("/influencers/coffee_lover");
  check("인플루언서 페이지에 공구 표시", r.status === 200 && r.data.verified && r.data.groupIds.includes(Number(listedId)));

  r = await api(`/tags/${listedId}/respond`, { token: inf.token, body: { action: "remove" } });
  r = await api("/tags");
  check("인플루언서가 태그를 내리면 비공개", !r.data.some((t: { groupId: number }) => t.groupId === Number(listedId)));

  // ── 사용자 프로필·배송지 ──
  r = await api("/users/me", { token: proposer.token });
  check("프로필 처음엔 배송지 없음", r.status === 200 && r.data.shipping === null && r.data.recipientHash === null);
  const ship = { name: "홍길동", phone: "010-1234-5678", zip: "06236", address1: "서울특별시 강남구 테헤란로 123", address2: "4층" };
  r = await api("/users/me", { token: proposer.token, method: "PUT", body: { nickname: "길동", shipping: { ...ship, zip: "123" } } });
  check("잘못된 우편번호 거부", r.status === 400);
  r = await api("/users/me", { token: proposer.token, method: "PUT", body: { nickname: "길동", contact: "gildong@example.com", shipping: ship } });
  const h1 = r.data.recipientHash as string;
  check("배송지 저장 → 배송지 해시 발급", r.status === 200 && /^0x[0-9a-f]{64}$/.test(h1) && r.data.nickname === "길동");
  r = await api("/users/me", { token: proposer.token, method: "PUT", body: { nickname: "길동", shipping: ship } });
  check("같은 배송지면 같은 해시 (솔트 유지)", r.data.recipientHash === h1);
  r = await api("/users/me", { token: proposer.token, method: "PUT", body: { nickname: "길동", shipping: { ...ship, address2: "5층" } } });
  check("배송지가 바뀌면 해시도 바뀜", r.data.recipientHash !== h1);
  r = await api("/users/me", { token: inf.token, method: "PUT", body: { shipping: ship } });
  check("다른 사람이 같은 주소를 써도 해시가 다름 (솔트)", r.data.recipientHash !== h1);

  r = await api("/sellers/me", { token: seller.token, method: "PATCH", body: { name: "오늘의 커피 로스터리", contact: "coffee@example.com" } });
  check("판매자 상호·연락처 수정", r.status === 200 && r.data.name === "오늘의 커피 로스터리");
  r = await api("/sellers/me", { token: proposer.token, method: "PATCH", body: { name: "가짜 상점", contact: "fake@example.com" } });
  check("판매자가 아니면 판매자 정보 수정 불가", r.status === 404);

  // ── 찜 ──
  r = await api("/likes", { token: proposer.token });
  check("찜 목록 처음엔 비어 있음", r.status === 200 && r.data.length === 0);
  r = await api("/likes/3", { token: proposer.token, body: {} });
  check("찜하기", r.status === 201 && r.data.liked);
  await api("/likes/3", { token: proposer.token, body: {} });
  r = await api("/likes", { token: proposer.token });
  check("같은 공구를 두 번 찜해도 하나", r.data.length === 1 && r.data[0] === 3);
  await api("/likes/3", { token: inf.token, body: {} });
  r = await api("/likes/counts");
  check("공구별 찜 수", r.data["3"] === 2);
  r = await api("/likes/99999", { token: proposer.token, body: {} });
  check("없는 공구는 찜 불가", r.status === 404);
  r = await api("/likes/3", { body: {} });
  check("로그인 없이 찜 불가", r.status === 401);
  r = await api("/likes/3", { token: proposer.token, method: "DELETE" });
  r = await api("/likes", { token: proposer.token });
  check("찜 해제", r.data.length === 0);

  console.log(failures ? `\n${failures}개 실패` : "\n모두 통과");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
