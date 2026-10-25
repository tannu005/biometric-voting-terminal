import os
import sys
import json
import time
import base64
import logging
from typing import Dict, Any, Optional
import requests
import numpy as np

try:
    import cv2
except Exception:
    cv2 = None

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from hardware.as608 import as608_sensor
from biometrics.face_verify import face_pipeline
from biometrics.fusion_engine import fusion_engine
from backend.crypto_utils import crypto_engine

logger = logging.getLogger("server")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

app = FastAPI(
    title="Biometric Voting Terminal",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(ROOT_DIR, "frontend", "static")
VOTER_DB_DIR = os.path.join(ROOT_DIR, "data", "voter_db")
try:
    os.makedirs(STATIC_DIR, exist_ok=True)
    os.makedirs(VOTER_DB_DIR, exist_ok=True)
except Exception:
    pass

if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
if os.path.exists(VOTER_DB_DIR):
    app.mount("/voter_db", StaticFiles(directory=VOTER_DB_DIR), name="voter_db")

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

PI_URL = os.environ.get("PI_URL", "http://192.168.50.2:8000").rstrip("/")
EVM_DEVICE_TOKEN = os.environ.get("EVM_DEVICE_TOKEN", "EVM-DEVICE-SECURE-LAN-TOKEN")
PI_HEADERS = {"X-Device-Token": EVM_DEVICE_TOKEN}
PI_TIMEOUT = 1.0

def query_pi_hardware(method: str, path: str, timeout: Optional[float] = None, **kwargs) -> Optional[Dict[str, Any]]:
    to = timeout if timeout is not None else PI_TIMEOUT
    try:
        resp = requests.request(method, f"{PI_URL}{path}", headers=PI_HEADERS, timeout=to, **kwargs)
        if resp.status_code == 200:
            return resp.json()
    except Exception:
        pass
    return None

class VoterLookupRequest(BaseModel):
    epic: str

class FaceVerifyRequest(BaseModel):
    epic: str
    image_data: Optional[str] = None
    force_mock: Optional[bool] = False

class FaceDetectRequest(BaseModel):
    image_data: str

class HardwareDisplayRequest(BaseModel):
    message: str

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

@app.get("/", response_class=HTMLResponse)
async def serve_kiosk_ui():
    html_path = os.path.join(ROOT_DIR, "frontend", "index.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h2>Terminal UI not found</h2>")

@app.get("/video_feed")
async def video_feed():
    if os.environ.get("VERCEL") or not face_pipeline.is_camera_available():
        return Response(content=b"", status_code=204)
    return StreamingResponse(
        face_pipeline.generate_mjpeg_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@app.post("/api/voter/lookup")
async def voter_lookup(req: VoterLookupRequest):
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
            detail={"error": "INELIGIBLE_VOTER", "message": "Voter marked ineligible."}
        )

    if crypto_engine.check_has_voted(epic):
        raise HTTPException(
            status_code=409,
            detail={"error": "ALREADY_VOTED", "message": "Double-voting rejected: Salted hash already exists."}
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

@app.get("/api/hardware/health")
async def hardware_health():
    pi_data = query_pi_hardware("GET", "/health")
    return {
        "connected": pi_data is not None,
        "pi_url": PI_URL,
        "pi": pi_data,
        "local_camera": face_pipeline.is_camera_available(),
        "local_as608": as608_sensor.is_connected or as608_sensor.mock_mode
    }

@app.post("/api/hardware/display")
async def hardware_display(req: HardwareDisplayRequest):
    result = query_pi_hardware("POST", "/display", json={"message": req.message})
    return {"success": result is not None, "result": result}

@app.get("/api/hardware/events")
async def hardware_events():
    data = query_pi_hardware("GET", "/events")
    return data or {"events": []}

@app.post("/api/biometrics/face-detect")
async def detect_live_face(req: FaceDetectRequest):
    try:
        raw_b64 = req.image_data
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        img_bytes = base64.b64decode(raw_b64)
        nparr = np.frombuffer(img_bytes, np.uint8)
        if cv2 is not None:
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is not None:
                return face_pipeline.detect_live_face_quick(frame)
    except Exception as e:
        logger.warning(f"Error in face-detect: {e}")
    return {
        "detected": False,
        "faces_count": 0,
        "box": None,
        "eyes_detected": False,
        "liveness_pass": False,
        "liveness_score": 0.0,
        "status": "DECODE_ERROR",
        "message": "Camera frame evaluation error"
    }

@app.post("/api/biometrics/face-verify")
async def verify_face(req: FaceVerifyRequest):
    epic = req.epic.strip().upper()
    snapshot_frame = None
    if req.image_data:
        try:
            raw_b64 = req.image_data
            if "," in raw_b64:
                raw_b64 = raw_b64.split(",", 1)[1]
            img_bytes = base64.b64decode(raw_b64)
            nparr = np.frombuffer(img_bytes, np.uint8)
            if cv2 is not None:
                snapshot_frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as e:
            logger.warning(f"Failed to decode face snapshot image: {e}")
            snapshot_frame = None

    result = fusion_engine.process_facial_verification(
        epic,
        snapshot_frame=snapshot_frame,
        force_mock=req.force_mock
    )
    status_summary = fusion_engine.get_session_status(epic)
    return {
        "verification": result,
        "session_status": status_summary
    }

@app.post("/api/biometrics/fingerprint-verify")
async def verify_fingerprint(req: FingerprintVerifyRequest):
    epic = req.epic.strip().upper()
    if req.method == "RPI_R307S_SENSOR":
        pi_match = query_pi_hardware("POST", "/fingerprint/match", timeout=req.timeout_sec or 12.0)
        if pi_match and pi_match.get("matched"):
            result = {
                "status": "MATCH_SUCCESS",
                "score": pi_match.get("score", 95),
                "template_id": pi_match.get("template_id", 1),
                "mode": "RPI_R307S_ETHERNET",
                "message": f"R307S Fingerprint verified (Score: {pi_match.get('score', 95)}%)"
            }
        else:
            reason = (pi_match or {}).get("reason", "Sensor timeout or no template match")
            result = {
                "status": "MATCH_FAIL",
                "score": 0,
                "mode": "RPI_R307S_ETHERNET",
                "message": f"Fingerprint rejected: {reason}"
            }
        session = fusion_engine.active_sessions.get(epic)
        if session:
            session["fingerprint_result"] = result
            fusion_engine._evaluate_consensus(session)
    elif req.method == "LAPTOP_HARDWARE_FINGERPRINT":
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
    epic = epic.strip().upper()
    return fusion_engine.get_session_status(epic)

@app.post("/api/ballot/authorize")
async def authorize_ballot(req: VoterLookupRequest):
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
    salted_voter_hash = crypto_engine.validate_and_consume_token(req.ephemeral_token)
    if not salted_voter_hash:
        raise HTTPException(
            status_code=401,
            detail={"error": "INVALID_TOKEN", "message": "Ephemeral authorization token expired or invalid."}
        )

    candidates = load_candidates()
    cand_dict = {}
    for idx, c in enumerate(candidates):
        cand_dict[c["id"]] = c
        cand_dict[str(c.get("contract_id", idx))] = c

    if req.candidate_id not in cand_dict:
        raise HTTPException(
            status_code=400,
            detail={"error": "INVALID_CANDIDATE", "message": f"Candidate ID '{req.candidate_id}' not found."}
        )
    candidate = cand_dict[req.candidate_id]

    payload = crypto_engine.create_ballot_payload(
        candidate_id=candidate["id"],
        contract_candidate_id=candidate.get("contract_id", 0),
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
            "candidate_id": candidate["id"],
            "contract_candidate_id": candidate.get("contract_id", 0),
            "candidate_name": candidate["name"],
            "party": candidate["party"],
            "symbol": candidate["symbol"],
            "timestamp": ledger_result["timestamp"],
            "zk_proof_receipt": ledger_result["zk_proof_receipt"],
            "ledger_status": ledger_result["ledger_status"],
            "blockchain_tx_hash": ledger_result.get("blockchain_tx_hash")
        },
        "message": "Vote successfully cast and recorded."
    }

@app.get("/api/system/status")
async def system_status():
    blockchain_ready = False
    try:
        from backend.blockchain_bridge import is_blockchain_ready
        blockchain_ready = is_blockchain_ready()
    except Exception:
        pass

    return {
        "status": "OPERATIONAL",
        "terminal_id": "KIOSK-TERMINAL-01",
        "blockchain": {
            "network": "Anvil Local Testnet",
            "chain_id": 31337,
            "contract_address": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
            "candidate_count": 3,
            "connected": blockchain_ready
        },
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
    crypto_engine.casted_hashes.clear()
    fusion_engine.active_sessions.clear()
    crypto_engine.active_ephemeral_tokens.clear()
    logger.info("Admin reset executed.")
    return {"success": True, "message": "Terminal state reset."}
