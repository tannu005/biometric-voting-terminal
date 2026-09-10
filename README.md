# Biometric Voting Terminal

A secure, hardware-enforced biometric electronic voting terminal built with Python, FastAPI, OpenCV, and WebAuthn. It combines multi-factor biometric authentication (facial recognition + physical fingerprint) with cryptographic decoupling to guarantee both voter verification and ballot secrecy.

Live Deployment: [https://biometric-voting-terminal.vercel.app](https://biometric-voting-terminal.vercel.app)

---

## Overview

Traditional voting systems often face a trade-off between identity verification and ballot secrecy. This project addresses that challenge with a two-phase decoupled architecture:

1. **Voter Authentication Phase**:
   - Voter enters their registration ID (EPIC).
   - Facial scan is verified using OpenCV feature extraction with passive liveness detection.
   - Physical fingerprint is verified via laptop biometric hardware (Windows Hello / Touch ID platform authenticator) or an external AS608 optical sensor over UART.
   - Upon dual-biometric consensus, voter identity is confirmed.

2. **Decoupled Ballot Phase**:
   - The system generates a deterministic, salted voter hash (SHA-256(EPIC + SALT)) to prevent double-voting.
   - An ephemeral, single-use token (valid for 180 seconds) is issued.
   - Raw biometrics and voter ID are purged from memory.
   - The voter selects a candidate. The cast ballot is signed with an ephemeral nonce and committed to an append-only audit ledger without any voter personal data attached.

---

## Architecture

`
+-------------------------------------------------------------+
|                      Kiosk Touch UI                         |
|   EPIC Input -> Face HUD -> Fingerprint -> Ballot -> VVPAT  |
+------------------------------+------------------------------+
                               | REST API
+------------------------------v------------------------------+
|                    FastAPI Local Server                     |
|  +-------------------------------------------------------+  |
|  | Face Pipeline (OpenCV Haar/Descriptors + Liveness)   |  |
|  | Fingerprint Driver (AS608 UART / WebAuthn Platform)  |  |
|  | Fusion Engine (Consensus Gate)                        |  |
|  | Cryptographic Decoupling (Salted Hash + Tokens)      |  |
|  +-------------------------------------------------------+  |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
|                 Append-Only Audit Ledger                    |
+-------------------------------------------------------------+
`

---

## Features

- **Dual-Biometric Verification**: Requires both facial match and physical fingerprint confirmation before unlocking the ballot.
- **Physical Sensor Support**:
  - Laptop power button / fingerprint reader via W3C Web Authentication API (uthenticatorAttachment: "platform").
  - External AS608 optical fingerprint module via serial UART (/dev/ttyUSB0, COMx).
- **Anti-Spoofing Liveness**: Evaluates frame-by-frame micro-motion to prevent photo and screen spoofing.
- **Double-Voting Prevention**: Deterministic salted hash records that a citizen has voted without linking identity to candidate choice.
- **VVPAT Receipt**: Provides a verifiable digital paper slip displaying the candidate selection, timestamp, and audit nonce.
- **Offline & Cloud Ready**: Runs locally on Raspberry Pi / laptops and serverlessly on Vercel.

---

## Project Structure

`
biometric-voting-terminal/
├── api/
│   └── index.py            # Vercel serverless entrypoint
├── backend/
│   ├── app.py              # FastAPI application server
│   └── crypto_utils.py     # Deterministic hashing and ledger
├── biometrics/
│   ├── face_verify.py      # OpenCV facial pipeline
│   └── fusion_engine.py    # Multi-modal consensus logic
├── hardware/
│   ├── as608.py            # AS608 UART driver
│   └── rpi_setup.sh        # Raspberry Pi configuration script
├── frontend/
│   ├── index.html          # Touch kiosk interface
│   └── static/
│       ├── app.js          # State machine and WebAuthn trigger
│       └── style.css       # Kiosk dark theme and VVPAT print styles
├── public/                 # Static assets for Vercel CDN
├── data/
│   ├── voters.json         # Sample constituency roll
│   ├── candidates.json     # Ballot candidates
│   └── voter_db/           # Reference portrait images
├── tests/
│   └── test_biometrics.py  # Unit and integration test suite
├── run_kiosk.py            # Local kiosk launcher
├── vercel.json             # Vercel deployment config
└── requirements.txt        # Dependencies
`

---

## Getting Started

### Prerequisites
- Python 3.10+
- Webcam / camera sensor
- Laptop fingerprint reader or AS608 optical fingerprint sensor (optional for physical mode; emulation fallback supported)

### Installation

`ash
git clone https://github.com/tannu005/biometric-voting-terminal.git
cd biometric-voting-terminal
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\activate
pip install -r requirements.txt
`

### Running Locally

`ash
python run_kiosk.py
`
Open your browser and navigate to http://localhost:8000.

### Running Tests

`ash
python tests/test_biometrics.py
`

### Raspberry Pi Setup

To run on a Raspberry Pi with an AS608 optical sensor wired via UART/USB:

`ash
sudo bash hardware/rpi_setup.sh
sudo reboot
python run_kiosk.py
`

---

## License

MIT