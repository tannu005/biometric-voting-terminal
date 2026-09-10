# Air-Gapped Hardware-Enforced Biometric Voting Terminal
### Module: Kiosk Interface & Dual-Biometric Hardware (Tannu's Deliverables)

> **Lead Architect & Hardware-Biometrics Lead:** Tannu  
> **System Classification:** Air-Gapped High-Security EVM-Blockchain Electronic Voting Terminal  
> **Standards Adherence:** IEEE 29115 Level-4 Entity Authentication, ISO/IEC 27001, W3C DID / ERC Standards  

---

## 📌 Executive Summary
This subsystem delivers the voter-facing touch kiosk, multimodal computer vision and embedded biometric hardware interfaces, and zero-knowledge cryptographic decoupling layer for the Air-Gapped Biometric Voting Terminal.

The architecture solves the core voting paradox: **guaranteeing absolute identity verification and mathematical double-voting prevention while strictly ensuring secret ballot anonymity.**

---

## 🏛️ System Architecture

```mermaid
graph TD
    subgraph "Edge Node Hardware Layer (Raspberry Pi / Laptop)"
        CAM[Optical Video Camera Sensor] -->|Frame Stream| CV[OpenCV / DeepFace Pipeline]
        AS608[AS608 Optical Fingerprint Scanner] -->|UART Serial 0xEF01| AS608_D[AS608 Driver Layer]
    end

    subgraph "Local Multimodal Consensus & Decoupling"
        CV -->|Liveness + Face Score| FUSION[Biometric Fusion Decision Engine]
        AS608_D -->|Ridge Minutiae MATCH_SUCCESS| FUSION
        FUSION -->|IEEE 29115 Level-4 Pass| CRYPTO[Cryptographic Decoupling Engine]
        EPIC[Voter EPIC ID] -->|One-Way Salted Hash| CRYPTO
        CRYPTO -->|Ephemeral Single-Use Token| KIOSK_UI[5-Stage Kiosk Touch UI]
    end

    subgraph "Immutable Ledger (Member B Web3 Module)"
        KIOSK_UI -->|Decoupled Signed Ballot Payload| WEB3[Solidity Smart Contract / Local EVM]
        WEB3 -->|require(!hasVoted[saltedHash])| LEDGER[(Append-Only Blockchain Ledger)]
    end
```

---

## 🚀 Key Deliverables Implemented

### 1. Raspberry Pi Hardware & AS608 Optical Fingerprint Driver
- **`hardware/as608.py`**: Direct packet-level UART driver implementing the AS608 optical sensor protocol:
  - Header `0xEF01`, address `0xFFFFFFFF`, command/data/ack packets, 16-bit checksum calculation.
  - Commands: image acquisition (`CMD_GET_IMAGE`), minutiae character generation (`CMD_GEN_CHAR`), library search (`CMD_SEARCH`), flash template storage.
  - Standardized binary response: `MATCH_SUCCESS` or `MATCH_FAIL`.
  - Auto-detects serial ports (`/dev/ttyUSB0`, `/dev/ttyS0`, Windows `COMx`) with automated fallback emulation for seamless offline laptop demonstration.
- **`hardware/rpi_setup.sh`**: Automated shell configuration for Raspberry Pi OS:
  - Configures user `dialout` and `video` group permissions.
  - Creates udev rule `/etc/udev/rules.d/99-as608-sensor.rules` (`MODE="0666"`).
  - Configures Raspberry Pi hardware UART (GPIO 14/15) while disabling conflicting serial console logins.

### 2. Computer Vision Facial Recognition Pipeline
- **`biometrics/face_verify.py`**: Real-time OpenCV and DeepFace computer vision pipeline:
  - Real-time webcam frame acquisition with hardware auto-configuration.
  - Live HUD overlay with targeting reticle, landmark framing, and operational badges.
  - **Passive Liveness Detection**: Evaluates temporal optical flow frame variances to detect human micro-movement/respiration, preventing static photo and digital screen spoofing.
  - Invariant normalized spatial descriptor extraction and cosine similarity matching against enrolled voter records in `data/voter_db/`.
- **`biometrics/fusion_engine.py`**: Multimodal sensor consensus engine:
  - Enforces simultaneous validation: Face Match $\ge 70\%$ + Liveness True + Fingerprint `MATCH_SUCCESS`.
  - Purges in-memory biometric data post-vote to satisfy electoral privacy and GDPR mandates.

### 3. Responsive Touch-Friendly Kiosk Web Interface
- **`frontend/index.html`**, **`frontend/static/style.css`**, **`frontend/static/app.js`**:
  - Touch-optimized, high-contrast kiosk terminal interface accessible via kiosk touchscreen, laptop display, or mobile browser.
  - Full **5-Stage Finite State Machine**:
    1. **EPIC Input**: Touch alphanumeric/numeric keypad and instant constituency roll verification.
    2. **Facial Scan Visualizer**: Real-time `/video_feed` MJPEG stream with interactive confidence gauge.
    3. **Fingerprint Prompt**: Animated optical scanner HUD with laser scan simulation and UART feedback.
    4. **Ballot Candidate Selection**: Accessible candidate tiles with party symbols, tactile selection modal, and confirmation safeguard.
    5. **Confirmation Receipt**: Digital VVPAT-style paper audit receipt displaying deterministic salted hash, ephemeral ballot nonce, and automated 6-second reset countdown.
  - Web Audio API synthesizer generating tactile feedback tones (touch beeps, verification chords, ballot chime).

### 4. Cryptographic Identity Decoupling
- **`backend/crypto_utils.py`**:
  - Computes deterministic salted voter hash: $\text{SHA-256}(\text{EPIC} \parallel \text{Election Salt})$.
  - Issues memory-bound ephemeral ballot tokens ($180\text{s}$ expiration, single-use consumption).
  - Generates decoupled Web3 ballot payload matching Member 2's `web3.py` engine with zero clear-text identity transmission.
  - Blocks double-voting attempts both locally and at the smart contract interface.

### 5. Patent & API Specifications
- **`docs/API_SPECIFICATION.md`**: Formally defined JSON API contracts connecting Member C (Kiosk/Biometrics), Member B (Web3), and Member D (Audit).
- **`docs/PATENT_CLAIMS_DRAFT.md`**: Complete patent application draft with 10 formal claims covering Hardware-Enforced Zero-Knowledge Ballot Generation and Multimodal Biometric Fusion.

---

## 🛠️ Quick Start & Live Demonstration

### 1. Run Automated Test Suite
```bash
python tests/test_biometrics.py
```

### 2. Launch the Kiosk Terminal
```bash
python run_kiosk.py
```
Open your browser to:
```
http://localhost:8000
```
*(Or access from any smartphone or tablet on the same Wi-Fi using `http://<your-laptop-ip>:8000`)*

### 3. Demo Voter Credentials (Pre-Enrolled)
| Voter Name | EPIC Number | Constituency | Fingerprint Slot |
| :--- | :--- | :--- | :--- |
| **Aarav Sharma** | `VOTE-IND-2026-001` | Central Tech - AC-07 | Slot 1 |
| **Priya Patel** | `VOTE-IND-2026-002` | Central Tech - AC-07 | Slot 2 |
| **Vikram Malhotra** | `VOTE-IND-2026-003` | Central Tech - AC-07 | Slot 3 |
| **Ananya Sen** | `VOTE-IND-2026-004` | Central Tech - AC-07 | Slot 4 |

---

## 📂 Project Directory Structure
```
biometric-voting-terminal/
├── backend/
│   ├── app.py                     # FastAPI Kiosk Server & REST Endpoints
│   └── crypto_utils.py            # Salted Hash & Ephemeral Token Engine
├── biometrics/
│   ├── face_verify.py             # OpenCV / DeepFace Facial Pipeline
│   └── fusion_engine.py           # Multimodal Biometric Consensus Coordinator
├── data/
│   ├── candidates.json            # Official Electoral Ballot Candidates
│   ├── voters.json                # Pre-enrolled Voter Registry
│   └── voter_db/                  # Reference Portrait Biometric Database
├── docs/
│   ├── API_SPECIFICATION.md       # Formally Defined JSON API Contract Schemas
│   └── PATENT_CLAIMS_DRAFT.md     # Technical Patent Claims Drafting
├── frontend/
│   ├── index.html                 # 5-State Touch Kiosk User Interface
│   └── static/
│       ├── app.js                 # State Machine & Web Audio Synthesizer
│       └── style.css              # High-Contrast Polling Booth Theme
├── hardware/
│   ├── as608.py                   # AS608 Optical Fingerprint UART Driver
│   └── rpi_setup.sh               # Raspberry Pi OS Configuration Script
├── tests/
│   └── test_biometrics.py         # Complete Automated Verification Suite
├── run_kiosk.py                   # Single-Command Kiosk Entrypoint
└── README.md                      # Subsystem Documentation
```
