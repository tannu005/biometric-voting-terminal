# API Specification
**System:** Biometric Voting Terminal  
**Format:** REST / JSON

---

## 1. Architectural Interface Topology

```
+-------------------------------------------------------------------------------+
|                             KIOSK FRONTEND LAYER                              |
|           (Touchscreen HUD, Audio Feedback, Stepper State Machine)            |
+---------------------------------------+---------------------------------------+
                                        | REST / JSON / MJPEG
+---------------------------------------v---------------------------------------+
|                          LOCAL TERMINAL BACKEND                               |
|       FastAPI Engine • OpenCV Face Pipeline • AS608 UART Driver               |
|            Deterministic Salted Hashing • Ephemeral Tokens                    |
+---------------------------------------+---------------------------------------+
                                        | POST Decoupled Payload
+---------------------------------------v---------------------------------------+
|                        LEDGER / SMART CONTRACT DISPATCH                       |
|           Append-Only Audit Ledger • Web3 Ballot Verification                 |
+---------------------------------------+---------------------------------------+
                                        | Audit Stream
+---------------------------------------v---------------------------------------+
|                              AUDIT PORTAL                                     |
|             Cryptographic Verification • Zero PII Leakage                     |
+-------------------------------------------------------------------------------+
```

---

## 2. API Endpoints Contract

### 2.1 Voter Eligibility & Registry Lookup
- **Endpoint:** `POST /api/voter/lookup`
- **Caller:** Kiosk UI (Step 1)
- **Request Schema:**
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "VoterLookupRequest",
  "type": "object",
  "properties": {
    "epic": {
      "type": "string",
      "pattern": "^[A-Z0-9-]{10,24}$",
      "description": "Unique Elector Photo Identity Card alphanumeric identifier"
    }
  },
  "required": ["epic"]
}
```
- **Response Schema (200 OK):**
```json
{
  "success": true,
  "voter": {
    "epic": "VOTE-IND-2026-001",
    "name": "Aarav Sharma",
    "constituency": "Central Tech Constituency - AC-07",
    "photo_url": "/voter_db/VOTE-IND-2026-001.jpg"
  },
  "next_step": "FACIAL_SCAN_VISUALIZER"
}
```
- **Error Responses:**
  - `404 Not Found`: `{"error": "VOTER_NOT_FOUND", "message": "EPIC not found in constituency roll."}`
  - `409 Conflict`: `{"error": "ALREADY_VOTED", "message": "Double-voting rejected: Salted hash already committed on ledger."}`

---

### 2.2 Live Facial Biometric Verification
- **Endpoint:** `POST /api/biometrics/face-verify`
- **Caller:** Kiosk UI (Step 2)
- **Request Schema:**
```json
{
  "epic": "VOTE-IND-2026-001",
  "force_mock": false
}
```
- **Response Schema (200 OK):**
```json
{
  "verification": {
    "status": "MATCH_SUCCESS",
    "match_score": 94.8,
    "confidence": 94.8,
    "distance": 0.16,
    "liveness": true,
    "liveness_score": 92.0,
    "engine": "OpenCV",
    "message": "Voter biometric facial identity verified (94.8% match)"
  },
  "session_status": {
    "exists": true,
    "voter_epic": "VOTE-IND-2026-001",
    "is_fully_validated": false,
    "rejection_reason": "Awaiting optical fingerprint placement"
  }
}
```

---

### 2.3 Optical Fingerprint Verification (AS608 UART)
- **Endpoint:** `POST /api/biometrics/fingerprint-verify`
- **Caller:** Kiosk UI (Step 3)
- **Request Schema:**
```json
{
  "epic": "VOTE-IND-2026-001",
  "timeout_sec": 5.0
}
```
- **Response Schema (200 OK):**
```json
{
  "verification": {
    "status": "MATCH_SUCCESS",
    "score": 95,
    "page_id": 1,
    "mode": "PHYSICAL_UART",
    "message": "Biometric ridge minutiae verified (Confidence: 95%)"
  },
  "session_status": {
    "exists": true,
    "voter_epic": "VOTE-IND-2026-001",
    "is_fully_validated": true,
    "validation_timestamp": 1789054045.2,
    "rejection_reason": null
  }
}
```

---

### 2.4 Ephemeral Ballot Authorization Token Generation
- **Endpoint:** `POST /api/ballot/authorize`
- **Description:** Issued strictly upon multimodal consensus (Face Score $\ge 70\%$ + Fingerprint `MATCH_SUCCESS`). Decouples biometric identity from ballot candidate selection.
- **Request Schema:**
```json
{
  "epic": "VOTE-IND-2026-001"
}
```
- **Response Schema (200 OK):**
```json
{
  "success": true,
  "ephemeral_token": "0x821b93cb98c4b50774e70069c38393985f2c3e06a553388ce18421b0b4112805",
  "expires_in_seconds": 180,
  "candidates": [
    {
      "id": "CAND-01",
      "name": "Dr. Rajeshwar Verma",
      "party": "National Progress Alliance",
      "symbol": "⚡"
    }
  ],
  "next_step": "BALLOT_CANDIDATE_SELECTION"
}
```

---

### 2.5 Decoupled Vote Casting & Web3 Broadcast
- **Endpoint:** `POST /api/ballot/cast`
- **Caller:** Kiosk UI (Step 5)
- **Dispatch:** Terminal Engine $\longrightarrow$ Append-Only Ledger / EVM Endpoint
- **Payload Schema:**
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Web3BallotPayload",
  "type": "object",
  "properties": {
    "protocol_version": { "type": "string", "enum": ["v1.2-EVM-AIRGAP"] },
    "ballot_nonce": { "type": "string", "pattern": "^0x[a-f0-9]{32}$" },
    "salted_voter_hash": {
      "type": "string",
      "pattern": "^0x[a-f0-9]{64}$",
      "description": "Deterministic Keccak/SHA-256 hash preventing double voting"
    },
    "candidate_id": { "type": "string" },
    "terminal_id": { "type": "string" },
    "timestamp": { "type": "integer" },
    "terminal_signature": { "type": "string", "pattern": "^0x[a-f0-9]{64}$" },
    "zk_proof_receipt": { "type": "string" }
  },
  "required": [
    "protocol_version",
    "ballot_nonce",
    "salted_voter_hash",
    "candidate_id",
    "terminal_id",
    "timestamp",
    "terminal_signature"
  ]
}
```
- **Response Schema (200 OK):**
```json
{
  "success": true,
  "receipt": {
    "ballot_nonce": "0x5259e0c5476e658e713a7441c7e256a2",
    "salted_voter_hash": "0xdd9aa0eb8fa5d861d16cc9e5739a2e81e283965a0dcc115cbae9395b5e2a21c1",
    "candidate_name": "Dr. Rajeshwar Verma",
    "party": "National Progress Alliance",
    "symbol": "⚡",
    "timestamp": 1789054049,
    "zk_proof_receipt": "zkSNARK-AUTH-PROOF-ed89b723234ee010",
    "ledger_status": "BROADCAST_TO_EVM_BLOCKCHAIN_CONFIRMED"
  },
  "message": "Vote successfully cast and broadcast to immutable blockchain ledger."
}
```

---

### 2.6 System Hardware Diagnostic Health
- **Endpoint:** `GET /api/system/status`
- **Consumer:** Terminal Status Bar & Audit Monitoring
- **Response (200 OK):**
```json
{
  "status": "OPERATIONAL",
  "terminal_id": "KIOSK-TERMINAL-01",
  "hardware": {
    "as608_fingerprint_scanner": {
      "active_mode": "PHYSICAL_UART",
      "port": "/dev/ttyUSB0",
      "is_connected": true,
      "handshake": true
    },
    "optical_camera": {
      "is_opened": true,
      "device_index": 0,
      "cv_backend": "OpenCV"
    }
  },
  "crypto": {
    "election_salt_configured": true,
    "votes_recorded": 142
  },
  "air_gap_isolation": "ENFORCED"
}
```
