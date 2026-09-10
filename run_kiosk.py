"""
Air-Gapped Hardware-Enforced Biometric Voting Kiosk Launcher
Starts the FastAPI server, handles live video feed, AS608 optical sensor,
and provides touch-friendly kiosk UI on local network.
"""

import os
import sys
import uvicorn
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("Launcher")

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    if base_dir not in sys.path:
        sys.path.insert(0, base_dir)

    print("==========================================================================")
    print("      AIR-GAPPED HARDWARE-ENFORCED BIOMETRIC VOTING TERMINAL             ")
    print("      Dual-Biometric Authentication // Web3 Cryptographic Decoupling      ")
    print("==========================================================================")
    print("  [+] Kiosk State Machine: EPIC -> Face HUD -> Fingerprint -> Ballot -> Receipt")
    print("  [+] Hardware Drivers: AS608 Optical Sensor (UART/USB) & OpenCV Video Stream")
    print("  [+] Web Interface: http://localhost:8000 (or http://0.0.0.0:8000)")
    print("==========================================================================\n")

    # Start Uvicorn ASGI Server
    uvicorn.run(
        "backend.app:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info"
    )

if __name__ == "__main__":
    main()
