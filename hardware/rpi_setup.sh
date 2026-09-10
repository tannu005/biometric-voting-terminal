#!/usr/bin/env bash
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo bash rpi_setup.sh"
  exit 1
fi

TARGET_USER="${SUDO_USER:-$USER}"

apt-get update
apt-get install -y \
    python3-pip \
    python3-dev \
    python3-venv \
    python3-opencv \
    libatlas-base-dev \
    libgl1-mesa-glx \
    libhdf5-dev \
    udev

usermod -a -G dialout "$TARGET_USER"
usermod -a -G video "$TARGET_USER"
usermod -a -G tty "$TARGET_USER"

cat << 'EOF' > /etc/udev/rules.d/99-as608.rules
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", ATTRS{idProduct}=="6001", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", KERNEL=="ttyUSB*", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", KERNEL=="ttyS0", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", KERNEL=="serial0", MODE="0666", GROUP="dialout"
EOF

udevadm control --reload-rules
udevadm trigger

BOOT_CONFIG="/boot/firmware/config.txt"
[ ! -f "$BOOT_CONFIG" ] && BOOT_CONFIG="/boot/config.txt"

if [ -f "$BOOT_CONFIG" ]; then
    if ! grep -q "^enable_uart=1" "$BOOT_CONFIG"; then
        echo "enable_uart=1" >> "$BOOT_CONFIG"
    fi
fi

CMDLINE_TXT="/boot/firmware/cmdline.txt"
[ ! -f "$CMDLINE_TXT" ] && CMDLINE_TXT="/boot/cmdline.txt"

if [ -f "$CMDLINE_TXT" ]; then
    sed -i -e 's/console=serial0,[0-9]\+ //g' "$CMDLINE_TXT"
    sed -i -e 's/console=ttyAMA0,[0-9]\+ //g' "$CMDLINE_TXT"
fi

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
    pydantic \
    cryptography \
    requests

echo "Setup completed."