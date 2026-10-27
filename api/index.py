import os
import sys
import traceback

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

try:
    from app import app
except Exception:
    err_str = traceback.format_exc()
    from fastapi import FastAPI
    from fastapi.responses import PlainTextResponse
    app = FastAPI(title="Error Diagnostic")

    @app.api_route('/', methods=['GET', 'POST', 'PUT', 'DELETE'])
    @app.api_route('/{full_path:path}', methods=['GET', 'POST', 'PUT', 'DELETE'])
    def catch_all(full_path: str = ""):
        return PlainTextResponse(f"Startup Exception:\n{err_str}", status_code=500)
