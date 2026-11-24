# ChainBuy · backend/server (FastAPI)

FastAPI + SQLAlchemy 2.0 + Alembic + PostgreSQL. 로그인은 지갑 서명 → JWT(12시간).
돈과 규칙은 컨트랙트가 맡고, 서버는 체인 밖 정보(상품·판매자·제안·프로필·인플루언서·찜)만 다룹니다.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
createdb chainbuy                       # 로컬 PostgreSQL
.venv/bin/alembic upgrade head          # 테이블 생성
.venv/bin/uvicorn app.main:app --port 4000 --reload
```

- API 문서: http://localhost:4000/docs
- 단위 테스트: `.venv/bin/python -m pytest -q tests`
- 전체 흐름(스모크): 로컬 체인·배포·서버가 켜진 상태에서 `cd ../smoke && npm install && npm run smoke`
- 환경 변수: `.env.example`, SNS OAuth 앱 등록: `OAUTH.md`
