#!/usr/bin/env bash
# ==============================================================================
# Hardware-Enforced Biometric Voting Terminal - Raspberry Pi Setup Script
# Configures:
# 1. Raspberry Pi OS serial ports (/dev/ttyUSB0 and /dev/ttyS0 /dev/serial0)
# 2. Linux udev permissions for non-root optical sensor access
# 3. Python 3 virtual environment and OpenCV / DeepFace hardware acceleration
# ==============================================================================

set -e

echo "=========================================================================="
echo "    Configuring Raspberry Pi OS for Biometric Voting Terminal"
echo "=========================================================================="

if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run with sudo: sudo bash rpi_setup.sh"
  exit 1
fi

TARGET_USER="${SUDO_USER:-$USER}"
echo "[+] Configuring setup for system user: $TARGET_USER"

# 1. Update package lists and install essential system libraries
echo "[+] Step 1: Installing system build dependencies & video libraries..."
apt-get update
apt-get install -y \
    python3-pip \
    python3-dev \
    python3-venv \
    python3-opencv \
    libatlas-base-dev \
    libgl1-mesa-glx \
    libhdf5-dev \
    libhdf5-serial-dev \
    libqtgui4 \
    libqt4-test \
    udev

# 2. Add current user to dialout and video groups for hardware access
echo "[+] Step 2: Granting user access to UART/USB Serial and Camera devices..."
usermod -a -G dialout "$TARGET_USER"
usermod -a -G video "$TARGET_USER"
usermod -a -G tty "$TARGET_USER"

# 3. Configure udev rules for AS608 Optical Fingerprint Scanner (USB-UART bridges: CP2102, CH340, FTDI, PL2303)
echo "[+] Step 3: Installing udev rules for AS608 optical sensor (/etc/udev/rules.d/99-as608-sensor.rules)..."
cat << 'EOF' > /etc/udev/rules.d/99-as608-sensor.rules
# AS608 Fingerprint Scanner USB-to-UART bridge permissions
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", ATTRS{idProduct}=="6001", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", KERNEL=="ttyUSB*", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", KERNEL=="ttyS0", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", KERNEL=="serial0", MODE="0666", GROUP="dialout"
EOF

udevadm control --reload-rules
udevadm trigger

# 4. Configure Raspberry Pi Hardware UART (pins GPIO 14 / 15)
# Disable serial console login on ttyAMA0/serial0, but enable hardware UART
echo "[+] Step 4: Configuring Raspberry Pi hardware serial port (/boot/firmware/config.txt)..."
BOOT_CONFIG="/boot/firmware/config.txt"
if [ ! -f "$BOOT_CONFIG" ]; then
    BOOT_CONFIG="/boot/config.txt"
fi

if [ -f "$BOOT_CONFIG" ]; then
    if ! grep -q "^enable_uart=1" "$BOOT_CONFIG"; then
        echo "enable_uart=1" >> "$BOOT_CONFIG"
        echo "[+] Added enable_uart=1 to $BOOT_CONFIG"
    fi
fi

# Disable serial console login (frees up UART for AS608 communication)
CMDLINE_TXT="/boot/firmware/cmdline.txt"
if [ ! -f "$CMDLINE_TXT" ]; then
    CMDLINE_TXT="/boot/cmdline.txt"
fi

if [ -f "$CMDLINE_TXT" ]; then
    sed -i -e 's/console=serial0,[0-9]\+ //g' "$CMDLINE_TXT"
    sed -i -e 's/console=ttyAMA0,[0-9]\+ //g' "$CMDLINE_TXT"
    echo "[+] Disabled serial console login in $CMDLINE_TXT to reserve port for AS608"
fi

# 5. Setup Python Virtual Environment and requirements
echo "[+] Step 5: Preparing isolated Python environment for Kiosk terminal..."
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

if [ ! -d "venv" ]; then
    sudo -u "$TARGET_USER" python3 -m venv --system-site-packages venv
fi

sudo -u "$TARGET_USER" "$APP_DIR/venv/bin/pip" install --upgrade pip
sudo -u "$TARGET_USER" "$APP_DIR/venv/bin/pip" install \
    fastapi \
    uvicorn \
    pyserial \
    opencv-python \
    numpy \
    pillow \
    pydantic \
    cryptography \
    requests

echo "=========================================================================="
echo " [SUCCESS] Raspberry Pi OS configuration complete!"
echo " Recommended: Reboot system once if hardware UART was just enabled:"
echo "              sudo reboot"
echo " To start the Kiosk interface:"
echo "              python run_kiosk.py"
echo "=========================================================================="
