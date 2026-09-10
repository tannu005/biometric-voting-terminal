import os
import sys
import urllib.parse
from fastapi import Request
from starlette.types import ASGIApp, Scope, Receive, Send

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(CURRENT_DIR)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.app import app

class VercelPathMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] == "http":
            qs = scope.get("query_string", b"").decode("latin1")
            if "__vpath" in qs:
                params = urllib.parse.parse_qs(qs)
                if "__vpath" in params and params["__vpath"]:
                    target_path = "/api/" + params["__vpath"][0].lstrip("/")
                    scope["path"] = target_path
                    del params["__vpath"]
                    scope["query_string"] = urllib.parse.urlencode(params, doseq=True).encode("latin1")
        await self.app(scope, receive, send)

app.add_middleware(VercelPathMiddleware)