# 인플루언서 SNS 계정 인증 (OAuth 앱 등록)

인플루언서가 "이 SNS 계정의 주인"임을 확인하는 데만 OAuth를 씁니다. 계정 ID와 사용자명만 받고, 받은 토큰은 저장하지 않습니다.

앱 키(환경 변수)가 설정된 플랫폼만 켜지고, 나머지는 화면에 "준비 중"으로 보입니다. 키 없이 흐름을 시험하려면 개발 모드에서 자동으로 켜지는 **테스트 계정(mock)** 을 쓰면 됩니다.

## 공통

- Redirect URI: `{API_PUBLIC_URL}/oauth/{platform}/callback`
  - 로컬 예: `http://localhost:4000/oauth/youtube/callback`
- 환경 변수는 `backend/api/.env` 에 넣고 서버를 다시 시작합니다 (`.env.example` 참고).
- 앱은 처음에 "개발/테스트 모드"로 만들어지고, 그 상태에서는 **테스터로 등록한 계정만** 로그인할 수 있습니다. 공개 서비스로 열려면 각 플랫폼의 앱 심사가 필요합니다.

| 플랫폼 | 콘솔 | 필요한 권한(scope) | 환경 변수 | 비고 |
| --- | --- | --- | --- | --- |
| YouTube | Google Cloud Console → API 및 서비스 | `youtube.readonly` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | YouTube Data API v3 사용 설정 필요. 채널이 없는 구글 계정은 인증 실패 |
| Instagram | Meta for Developers → 앱 만들기 → Instagram (Instagram 로그인) | `instagram_business_basic` | `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET` | 프로페셔널(비즈니스·크리에이터) 계정만 |
| Threads | Meta for Developers → 앱 만들기 → Threads API | `threads_basic` | `THREADS_CLIENT_ID`, `THREADS_CLIENT_SECRET` | 개발 모드에서는 Threads 테스터 등록 필요 |
| TikTok | TikTok for Developers → Manage apps → Login Kit | `user.info.basic`, `user.info.profile` | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | 새 앱은 샌드박스, 사용자명은 `user.info.profile` 권한 필요 |

제외한 플랫폼
- **X(트위터)**: 무료 등급 조회 한도가 매우 작아 사실상 유료
- **네이버 블로그 등 OAuth로 소유를 확인할 수 없는 곳**: 담당자 이메일 인증으로 따로 처리

## YouTube 예시 (가장 간단)

1. Google Cloud Console에서 프로젝트 만들기
2. "API 및 서비스 → 라이브러리"에서 **YouTube Data API v3** 사용 설정
3. "OAuth 동의 화면" 설정 → 테스트 사용자에 본인 구글 계정 추가
4. "사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션"
   - 승인된 리디렉션 URI: `http://localhost:4000/oauth/youtube/callback`
5. 발급된 ID·Secret을 `.env` 에 넣고 API 서버 재시작

## 확인 상태

- mock 제공자로 전체 흐름(시작 → 콜백 → 계정 저장 → 중복·재사용 차단)은 `npm run smoke` 로 확인됨
- 실제 플랫폼 4곳은 앱 키가 없어 **실제 로그인으로는 아직 확인하지 않음**. 엔드포인트는 각 플랫폼 문서 기준으로 작성함
