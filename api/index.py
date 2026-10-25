import os
import sys
import traceback
from fastapi import FastAPI
from fastapi.responses import JSONResponse

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

try:
    from app import app
except Exception as e:
    err_tb = traceback.format_exc()
    app = FastAPI(title="Error Diagnostic")

    @app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE"])
    async def catch_all_error(full_path: str):
        return JSONResponse(status_code=500, content={"error": str(e), "traceback": err_tb})
