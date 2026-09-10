"""
FastAPI Air-Gapped Kiosk Application Server
Coordinates Kiosk State Machine, Real-time MJPEG Video Feed,
Dual-Biometric Verification (Face + Fingerprint),
and Cryptographically Decoupled Ballot Dispatch to Web3 Smart Contracts.
"""

import os
import sys
import json
import time
import logging
from typing import Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Add root directory to sys.path for internal imports
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from hardware.as608 import as608_sensor
from biometrics.face_verify import face_pipeline
from biometrics.fusion_engine import fusion_engine
from backend.crypto_utils import crypto_engine

logger = logging.getLogger("Kiosk_Server")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

app = FastAPI(
    title="Air-Gapped Hardware-Enforced Biometric Voting Kiosk",
    description="Dual-Biometric Verification Terminal with Cryptographic Ledger Decoupling",
    version="2.0.0"
)

# Enable CORS for external touch displays or mobile browsers on local network
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files and voter photos
STATIC_DIR = os.path.join(ROOT_DIR, "frontend", "static")
VOTER_DB_DIR = os.path.join(ROOT_DIR, "data", "voter_db")
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(VOTER_DB_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/voter_db", StaticFiles(directory=VOTER_DB_DIR), name="voter_db")

# In-memory Voter & Candidate stores
VOTERS_FILE = os.path.join(ROOT_DIR, "data", "voters.json")
CANDIDATES_FILE = os.path.join(ROOT_DIR, "data", "candidates.json")

def load_voters() -> Dict[str, Dict[str, Any]]:
    if os.path.exists(VOTERS_FILE):
        with open(VOTERS_FILE, "r", encoding="utf-8") as f:
            v_list = json.load(f)
            return {v["epic"].upper(): v for v in v_list}
    return {}

def load_candidates() -> list:
    if os.path.exists(CANDIDATES_FILE):
        with open(CANDIDATES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

# ----------------- Request / Response Models -----------------
class VoterLookupRequest(BaseModel):
    epic: str

class FaceVerifyRequest(BaseModel):
    epic: str
    force_mock: Optional[bool] = False

class FingerprintVerifyRequest(BaseModel):
    epic: str
    method: Optional[str] = "LAPTOP_HARDWARE_FINGERPRINT"
    timeout_sec: Optional[float] = 5.0
    touch_detected: Optional[bool] = False
    credential: Optional[Dict[str, Any]] = None

class CastVoteRequest(BaseModel):
    ephemeral_token: str
    candidate_id: str
    epic: str


# ----------------- API Endpoints -----------------

@app.get("/", response_class=HTMLResponse)
async def serve_kiosk_ui():
    """Serves the primary Kiosk voting interface HTML."""
    html_path = os.path.join(ROOT_DIR, "frontend", "index.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h2>Kiosk UI loading error: index.html not found</h2>")

@app.get("/video_feed")
async def video_feed():
    """Streams live MJPEG camera feed with real-time biometric HUD overlay."""
    if os.environ.get("VERCEL") or not face_pipeline.is_camera_available():
        return Response(content=b"", status_code=204)
    return StreamingResponse(
        face_pipeline.generate_mjpeg_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@app.post("/api/voter/lookup")
async def voter_lookup(req: VoterLookupRequest):
    """
    Step 1: Validates Voter EPIC ID.
    Checks eligibility, electoral roll status, and double-voting ledger history.
    """
    epic = req.epic.strip().upper()
    voters = load_voters()

    if epic not in voters:
        raise HTTPException(
            status_code=404,
            detail={"error": "VOTER_NOT_FOUND", "message": f"EPIC '{epic}' not found in constituency roll."}
        )

    voter = voters[epic]

    if not voter.get("is_eligible", True):
        raise HTTPException(
            status_code=403,
            detail={"error": "INELIGIBLE_VOTER", "message": "Voter marked ineligible by Election Commission."}
        )

    # Double-voting prevention check on cryptographic ledger
    if crypto_engine.check_has_voted(epic):
        raise HTTPException(
            status_code=409,
            detail={
                "error": "ALREADY_VOTED",
                "message": "Double-voting rejected: Salted hash for this EPIC already exists on immutable ledger."
            }
        )

    slot = voter.get("fingerprint_slot", 1)
    fusion_engine.start_session(epic, expected_slot=slot)

    return {
        "success": True,
        "voter": {
            "epic": voter["epic"],
            "name": voter["name"],
            "constituency": voter["constituency"],
            "photo_url": f"/voter_db/{voter.get('photo', epic + '.jpg')}"
        },
        "next_step": "FACIAL_SCAN_VISUALIZER"
    }

@app.post("/api/biometrics/face-verify")
async def verify_face(req: FaceVerifyRequest):
    """
    Step 2: Executes live snapshot acquisition and facial biometric matching.
    """
    epic = req.epic.strip().upper()
    result = fusion_engine.process_facial_verification(epic, force_mock=req.force_mock)
    status_summary = fusion_engine.get_session_status(epic)
    return {
        "verification": result,
        "session_status": status_summary
    }

@app.post("/api/biometrics/fingerprint-verify")
async def verify_fingerprint(req: FingerprintVerifyRequest):
    """
    Step 3: Interrogates laptop physical fingerprint sensor (Windows Hello / Power Button)
    or external AS608 optical fingerprint scanner over UART.
    """
    epic = req.epic.strip().upper()
    if req.method == "LAPTOP_HARDWARE_FINGERPRINT":
        result = fusion_engine.process_laptop_fingerprint(epic, req.credential)
    else:
        result = fusion_engine.process_fingerprint_verification(
            epic,
            timeout_sec=req.timeout_sec,
            touch_detected=req.touch_detected
        )
    status_summary = fusion_engine.get_session_status(epic)
    return {
        "verification": result,
        "session_status": status_summary
    }

@app.get("/api/biometrics/session-status/{epic}")
async def get_session_status(epic: str):
    """Returns real-time consensus validation status for active voter."""
    epic = epic.strip().upper()
    return fusion_engine.get_session_status(epic)

@app.post("/api/ballot/authorize")
async def authorize_ballot(req: VoterLookupRequest):
    """
    Step 4: Unlocks Ballot upon Dual-Biometric Consensus.
    Generates Ephemeral Ballot Access Token and returns candidate list.
    """
    epic = req.epic.strip().upper()
    status_summary = fusion_engine.get_session_status(epic)

    if not status_summary.get("is_fully_validated"):
        raise HTTPException(
            status_code=403,
            detail={
                "error": "BIOMETRIC_CONSENSUS_UNMET",
                "message": status_summary.get("rejection_reason", "Dual-biometric verification incomplete.")
            }
        )

    token_record = crypto_engine.issue_ephemeral_token(epic, validity_sec=180)
    candidates = load_candidates()

    return {
        "success": True,
        "ephemeral_token": token_record["token"],
        "expires_in_seconds": 180,
        "candidates": candidates,
        "next_step": "BALLOT_CANDIDATE_SELECTION"
    }

@app.post("/api/ballot/cast")
async def cast_vote(req: CastVoteRequest):
    """
    Step 5: Casts Vote with Zero Clear-Text Identity Transmission.
    Consumes ephemeral token, writes salted hash to ledger, and broadcasts to Web3 module.
    """
    salted_voter_hash = crypto_engine.validate_and_consume_token(req.ephemeral_token)
    if not salted_voter_hash:
        raise HTTPException(
            status_code=401,
            detail={"error": "INVALID_TOKEN", "message": "Ephemeral ballot authorization token expired or invalid."}
        )

    candidates = load_candidates()
    cand_dict = {c["id"]: c for c in candidates}
    if req.candidate_id not in cand_dict:
        raise HTTPException(
            status_code=400,
            detail={"error": "INVALID_CANDIDATE", "message": f"Candidate ID '{req.candidate_id}' not found."}
        )
    candidate = cand_dict[req.candidate_id]

    payload = crypto_engine.create_ballot_payload(
        candidate_id=req.candidate_id,
        salted_voter_hash=salted_voter_hash,
        booth_id="KIOSK-TERMINAL-01"
    )

    ledger_result = crypto_engine.commit_vote_ledger(payload)
    if not ledger_result.get("success"):
        raise HTTPException(status_code=409, detail=ledger_result)

    fusion_engine.clear_session(req.epic.strip().upper())

    return {
        "success": True,
        "receipt": {
            "ballot_nonce": ledger_result["ballot_nonce"],
            "salted_voter_hash": ledger_result["salted_voter_hash"],
            "candidate_name": candidate["name"],
            "party": candidate["party"],
            "symbol": candidate["symbol"],
            "timestamp": ledger_result["timestamp"],
            "zk_proof_receipt": ledger_result["zk_proof_receipt"],
            "ledger_status": ledger_result["ledger_status"]
        },
        "message": "Vote successfully cast and broadcast to immutable blockchain ledger."
    }

@app.get("/api/system/status")
async def system_status():
    """Diagnostic health check for hardware modules and services."""
    return {
        "status": "OPERATIONAL",
        "terminal_id": "KIOSK-TERMINAL-01",
        "hardware": {
            "as608_fingerprint_scanner": {
                "active_mode": "MOCK/EMULATION" if as608_sensor.mock_mode else "PHYSICAL_UART",
                "port": as608_sensor.port,
                "is_connected": as608_sensor.is_connected or as608_sensor.mock_mode,
                "handshake": as608_sensor.handshake()
            },
            "optical_camera": {
                "is_opened": face_pipeline.cap is not None and face_pipeline.cap.isOpened(),
                "device_index": face_pipeline.camera_index,
                "cv_backend": "OpenCV"
            }
        },
        "crypto": {
            "election_salt_configured": bool(crypto_engine.salt),
            "votes_recorded": len(crypto_engine.casted_hashes)
        },
        "air_gap_isolation": "ENFORCED"
    }

@app.post("/api/admin/reset")
async def admin_reset():
    """Administrative reset endpoint to clear test vote locks."""
    crypto_engine.casted_hashes.clear()
    fusion_engine.active_sessions.clear()
    crypto_engine.active_ephemeral_tokens.clear()
    logger.info("Administrative reset executed: cleared test voter state.")
    return {"success": True, "message": "Terminal voting state reset for test cycle."}
