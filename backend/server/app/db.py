"""DB 연결 (SQLAlchemy 2.0)

요청마다 세션을 하나 열고, **응답을 보내기 전에** 커밋한다.
FastAPI의 yield 의존성 정리 코드는 응답을 보낸 뒤에 실행되기 때문에, 거기서 커밋하면
바로 이어지는 요청이 아직 저장되지 않은 데이터를 볼 수 있다. 그래서 CommitRoute가
핸들러가 끝나는 즉시 커밋한다. (Spring의 @Transactional이 메서드 종료 시 커밋하는 것과 같은 효과)
"""

from collections.abc import Iterator

from fastapi import Request
from fastapi.routing import APIRoute
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

def _url(raw: str) -> str:
    """호스팅 업체가 주는 postgres:// 주소를 psycopg 드라이버 주소로 맞춘다"""
    for prefix in ("postgres://", "postgresql://"):
        if raw.startswith(prefix):
            return "postgresql+psycopg://" + raw[len(prefix):]
    return raw


engine = create_engine(_url(settings().database_url), pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=True, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db(request: Request) -> Iterator[Session]:
    db = SessionLocal()
    request.state.db = db
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


class CommitRoute(APIRoute):
    """핸들러가 정상으로 끝나면 응답을 보내기 전에 커밋, 예외면 롤백"""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def route(request: Request):
            try:
                response = await handler(request)
            except Exception:
                db = getattr(request.state, "db", None)
                if db is not None:
                    db.rollback()
                raise
            db = getattr(request.state, "db", None)
            if db is not None:
                db.commit()
            return response

        return route
