# ChainBuy · backend/server (FastAPI)

FastAPI + SQLAlchemy 2.0 + Alembic + PostgreSQL. 로그인은 지갑 서명 → JWT(12시간).
돈과 규칙은 컨트랙트가 맡고, 서버는 체인 밖 정보(상품·판매자·제안·프로필·인플루언서·찜)만 다룹니다.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
createdb chainbuy                       # 로컬 PostgreSQL (또는: docker compose up -d db 후 .env의 DATABASE_URL 변경)
.venv/bin/alembic upgrade head          # 테이블 생성
.venv/bin/uvicorn app.main:app --port 4000 --reload
```

- API 문서: http://localhost:4000/docs
- 단위 테스트: `.venv/bin/python -m pytest -q tests`
- 전체 흐름(스모크): 로컬 체인·배포·서버가 켜진 상태에서 `cd ../smoke && npm install && npm run smoke`
- 환경 변수: `.env.example`, SNS OAuth 앱 등록: `OAUTH.md`

## AI 구매 대행 에이전트

```bash
.venv/bin/python -m app.agent      # 10초마다 모든 공구를 보고 다음 단계를 진행
```

- AGENT 역할 지갑(`AGENT_KEY`, 로컬 기본값 hardhat #2)으로 트랜잭션을 보냅니다.
- 상품 확인: 입점 상품은 등록 가격, 외부 상품은 mock 쇼핑몰 화면을 LLM(`LLM_API_KEY`)으로 읽고, 키가 없으면 규칙 기반으로 읽습니다. 페이지 글은 지시로 따르지 않습니다.
- 결제는 담당자가 `/admin` → 결제 승인 탭에서 승인한 뒤에만 진행됩니다.
- 외부 상품(경로 B)과 배송 확인은 mock 서비스(`MOCK_URL`, 기본 http://localhost:4100)가 필요합니다.
- 활동 기록: `GET /groups/{id}/activity`
