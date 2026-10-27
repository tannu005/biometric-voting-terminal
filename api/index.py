import os
import sys
import traceback
import urllib.parse
from starlette.types import ASGIApp, Scope, Receive, Send

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

try:
    from app import app

    class VercelPathMiddleware:
        def __init__(self, inner: ASGIApp):
            self.inner = inner

        async def __call__(self, scope: Scope, receive: Receive, send: Send):
            if scope["type"] == "http":
                raw_qs = scope.get("query_string", b"").decode("latin1")
                if "path=" in raw_qs:
                    params = urllib.parse.parse_qs(raw_qs)
                    if "path" in params and params["path"]:
                        target = params.pop("path")[0].strip("/")
                        scope["path"] = f"/api/{target}"
                        scope["query_string"] = urllib.parse.urlencode(params, doseq=True).encode("latin1")
            await self.inner(scope, receive, send)

    app.add_middleware(VercelPathMiddleware)

except Exception:
    err_str = traceback.format_exc()
    from fastapi import FastAPI
    from fastapi.responses import PlainTextResponse
    app = FastAPI(title="Error Diagnostic")

    @app.api_route('/', methods=['GET', 'POST', 'PUT', 'DELETE'])
    @app.api_route('/{full_path:path}', methods=['GET', 'POST', 'PUT', 'DELETE'])
    def catch_all(full_path: str = ""):
        return PlainTextResponse(f"Startup Exception:\n{err_str}", status_code=500)
