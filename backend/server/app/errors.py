"""에러 응답을 기존 API와 같은 형식 {"error": "메시지"}로 맞춘다 (Spring의 @ControllerAdvice 역할)."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


def _field_msg(err: dict) -> str:
    loc = ".".join(str(x) for x in err.get("loc", []) if x != "body")
    msg = err.get("msg", "")
    # pydantic 메시지 앞의 "Value error, " 제거
    msg = msg.removeprefix("Value error, ")
    return f"{loc}: {msg}" if loc else msg


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api(_: Request, e: ApiError):
        return JSONResponse({"error": e.message}, status_code=e.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, e: RequestValidationError):
        # 입력 검증 실패는 400 (FastAPI 기본 422 대신, 기존 API와 같게)
        return JSONResponse({"error": ", ".join(_field_msg(x) for x in e.errors())}, status_code=400)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        return JSONResponse({"error": str(e.detail)}, status_code=e.status_code)

    @app.exception_handler(Exception)
    async def _unknown(_: Request, e: Exception):
        import traceback

        traceback.print_exception(e)
        return JSONResponse({"error": "서버 오류가 발생했어요."}, status_code=500)
