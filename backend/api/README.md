# ChainBuy · backend/api

판매자 입점·상품 정보·외부 상품 제안을 저장하는 API입니다. (Express + SQLite)
돈과 규칙은 컨트랙트가 맡고, 서버는 체인 밖 정보만 다룹니다. 체인 기록이 필요한 승인은 담당자가 자기 지갑으로 직접 보내고, 서버는 체인을 읽어 확인한 뒤에만 상태를 바꿉니다.

```bash
npm install
npm run dev      # http://localhost:4000 (로컬 체인·배포가 먼저 필요)
npm run smoke    # 판매자·제안 전체 흐름 확인
```

## 인플루언서 SNS 인증

YouTube·Instagram(프로페셔널)·Threads·TikTok OAuth로 계정 소유를 확인합니다. 앱 등록 방법은 [OAUTH.md](OAUTH.md), 환경 변수는 `.env.example` 참고.

## 로그인 (지갑 서명)

1. `POST /auth/nonce {address}` → 서명할 문구
2. 지갑으로 서명 → `POST /auth/verify {address, signature}` → `token`
3. 이후 `Authorization: Bearer <token>`

담당자 여부는 컨트랙트의 `REVIEWER_ROLE`을 그대로 따릅니다.

## API

| 메서드 | 경로 | 권한 | 설명 |
| --- | --- | --- | --- |
| GET | `/products` | - | 상품 정보 (공구는 productHash로 연결) |
| POST | `/sellers` | 로그인 | 판매자 신청 |
| GET | `/sellers/me` | 로그인 | 내 신청 상태 |
| POST | `/products` | 승인 판매자 | 상품 등록 |
| GET | `/products/mine` | 승인 판매자 | 내 상품 |
| POST | `/proposals` | 로그인 | 외부 상품 공구 제안 (허용 쇼핑몰·https만) |
| GET | `/proposals/mine` | 로그인 | 내 제안 |
| GET | `/admin/sellers`, `/admin/proposals` | 담당자 | 검토 목록 |
| POST | `/admin/sellers/:id/approve` | 담당자 | 체인 `setSeller` 확인 후 승인 |
| POST | `/admin/proposals/:id/approve {groupId}` | 담당자 | 체인 `createExternalGroup` 확인 후 승인 |
| POST | `/admin/*/:id/reject {reason}` | 담당자 | 거절 |
| POST | `/influencers` | 로그인 | 인플루언서 프로필 만들기·수정 |
| GET | `/influencers/me` | 로그인 | 내 프로필·연결 계정·받은 태그 |
| GET | `/influencers`, `/influencers/:handle` | - | 인증된 인플루언서 목록, 공개 프로필 |
| GET | `/oauth/providers` | - | 켜진 OAuth 플랫폼 |
| POST | `/oauth/:platform/start` | 로그인 | SNS 로그인 주소 발급 (state·PKCE) |
| GET | `/oauth/:platform/callback` | - | 계정 확인 후 프론트로 돌아감 |
| POST | `/groups/:id/tags {handle}` | 그 공구의 판매자 | 협찬 태그 요청 (체인으로 판매자 확인) |
| POST | `/tags/:groupId/respond {action}` | 태그받은 인플루언서 | accept · reject · remove |
| GET | `/tags` | - | 공개된(수락된) 협찬 태그 |
