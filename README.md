# Biometric Voting Terminal

A voting kiosk web app with dual biometric authentication (face recognition + fingerprint scan). It verifies voter identity before allowing ballot access, while keeping the cast votes decoupled from personal details to preserve ballot secrecy.

Demo: https://biometric-voting-terminal.vercel.app

## What it does

1. **Voter verification**: Looks up the voter by EPIC card number, runs face match with a quick liveness check via camera, and checks the fingerprint (supports laptop power-button sensor via Windows Hello/Touch ID, or an external AS608 optical sensor).
2. **Decoupled ballot**: Once biometrics pass, an ephemeral one-time token is created and voter details are removed from the active session.
3. **Vote casting**: The user picks their candidate, the vote is logged with a salted hash to block double-voting, and a printable VVPAT-style receipt is generated.

## Setup & Run

### 1. Clone & install dependencies

```bash
git clone https://github.com/tannu005/biometric-voting-terminal.git
cd biometric-voting-terminal
python -m venv venv
# Windows
.\venv\Scripts\activate
# Linux/macOS
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Start the server

```bash
python run_kiosk.py
```

Then open http://localhost:8000 in your browser.

### 3. Running tests

```bash
python tests/test_biometrics.py
```

## Hardware Setup (Raspberry Pi + R307S / AS608)

The system works in two modes:
- **Standalone Mode**: Runs directly on any laptop or desktop using the built-in webcam and platform authenticator (Windows Hello / Touch ID).
- **Distributed Hardware Mode**: Laptop acts as the kiosk terminal while a Raspberry Pi acts as the physical hardware agent connected via direct Ethernet cable.

### Direct Ethernet Configuration

Connect an Ethernet patch cable between the laptop and the Raspberry Pi:
- **Laptop**: IP `192.168.50.1`, Subnet `255.255.255.0`
- **Raspberry Pi**: IP `192.168.50.2`, Subnet `255.255.255.0`

### Running the Raspberry Pi Hardware Agent

On the Raspberry Pi:
1. Run setup:
   ```bash
   sudo bash raspberry_pi/setup_pi.sh
   sudo reboot
   ```
2. Start the hardware agent:
   ```bash
   cd biometric-voting-terminal
   source venv/bin/activate
   python raspberry_pi/pi_agent.py
   ```

The hardware agent manages:
- **R307S / AS608 Fingerprint Scanner**: Connected via UART (`/dev/ttyS0` or `/dev/ttyUSB0` at 57600 baud).
- **Raspberry Pi Camera**: Captures high-res verification photos.
- **16x2 I2C LCD (PCF8574)**: Displays real-time voting status and prompts at I2C address `0x27`.
- **3 Tactical Switches**:
  - Switch 1 (GPIO 17): Previous candidate / Cancel.
  - Switch 2 (GPIO 27): Next candidate / Cycle.
  - Switch 3 (GPIO 22): Confirm / Vote.

If the Raspberry Pi is not connected, the kiosk automatically falls back to local operation with simulated hardware.

## Blockchain & Smart Contract Integration

The kiosk aligns directly with the Foundry `VotingSystem.sol` smart contract:
- **Contract Address**: `0x5FbDB2315678afecb367f032d93F642f64180aa3` (Anvil Chain ID: `31337`)
- **Default System Salt**: `LOCAL_TEST_SALT_2026`
- **Candidate Count**: Exactly 3 candidates matching contract deployment (`uint256 candidateCount = 3`):
  - **Slot 0**: Dr. Rajeshwar Verma (`⚡` National Progress Alliance)
  - **Slot 1**: Sunita Deshmukh (`🌾` People's Integrity Front)
  - **Slot 2**: Kabir Al-Mansoor (`⚖️` Democratic Reform Coalition)
- **On-Chain Dispatch**: Calls `castVote(bytes32 voterHash, uint256 candidateId)` with deterministic salted hash and records the transaction receipt.

## Tech Stack

- **Backend**: FastAPI, Uvicorn, Python 3
- **Biometrics**: OpenCV, WebAuthn (Windows Hello / Platform Authenticator), AS608 UART driver
- **Frontend**: HTML5, CSS3, Vanilla JS
- **Deployment**: Vercel (FastAPI Serverless)

## License

MIT
