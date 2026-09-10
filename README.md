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

## Hardware Setup (Raspberry Pi + AS608)

If you are running this on a Raspberry Pi with an AS608 optical fingerprint reader wired over USB/UART:

1. Connect the AS608 TX/RX pins or plug in via USB-UART adapter.
2. Run the setup script to grant serial permissions and enable UART:
   ```bash
   sudo bash hardware/rpi_setup.sh
   sudo reboot
   ```
3. Start the app:
   ```bash
   python run_kiosk.py
   ```

If no hardware sensor is detected, the app automatically switches to emulation mode so you can test it on any machine.

## Tech Stack

- **Backend**: FastAPI, Uvicorn, Python 3
- **Biometrics**: OpenCV, WebAuthn (Windows Hello / Platform Authenticator), AS608 UART driver
- **Frontend**: HTML5, CSS3, Vanilla JS
- **Deployment**: Vercel (FastAPI Serverless)

## License

MIT
