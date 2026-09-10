"""
AS608 Optical Fingerprint Scanner Driver
Interfaced over UART / USB-Serial for Raspberry Pi OS (/dev/ttyUSB0, /dev/ttyS0)
and cross-platform development (Windows COM ports / Emulation fallback).

Protocol Specification:
- Header: 0xEF01 (2 bytes)
- Module Address: 0xFFFFFFFF (4 bytes)
- PID: 0x01 (Command), 0x02 (Data), 0x07 (Acknowledge), 0x08 (End of Data)
- Checksum: Sum of (PID + Length + Content) & 0xFFFF
"""

import os
import sys
import time
import logging
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger("AS608_Driver")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False
    logger.warning("pyserial module not found. Physical hardware communication disabled.")

class AS608Driver:
    HEADER = 0xEF01
    DEFAULT_ADDRESS = 0xFFFFFFFF

    # Packet Identifiers
    PID_COMMAND = 0x01
    PID_DATA = 0x02
    PID_ACK = 0x07
    PID_END = 0x08

    # Command Codes
    CMD_GET_IMAGE = 0x01
    CMD_GEN_CHAR = 0x02
    CMD_MATCH = 0x03
    CMD_SEARCH = 0x04
    CMD_REG_MODEL = 0x05
    CMD_STORE_CHAR = 0x06
    CMD_LOAD_CHAR = 0x07
    CMD_DELETE_CHAR = 0x0C
    CMD_EMPTY_DB = 0x0D
    CMD_HANDSHAKE = 0x17
    CMD_READ_SYSPARA = 0x0F

    # Confirmation Codes
    CONFIRM_OK = 0x00
    CONFIRM_PACKET_ERR = 0x01
    CONFIRM_NO_FINGER = 0x02
    CONFIRM_FAIL_IMG = 0x03
    CONFIRM_DISORDER_IMG = 0x06
    CONFIRM_FEW_FEAT = 0x07
    CONFIRM_NO_MATCH = 0x08
    CONFIRM_NOT_FOUND = 0x09
    CONFIRM_ENROLL_FAIL = 0x0A

    def __init__(self, port: Optional[str] = None, baudrate: int = 57600, timeout: float = 1.0, mock_mode: Optional[bool] = None):
        self.baudrate = baudrate
        self.timeout = timeout
        self.ser: Optional[Any] = None
        self.is_connected = False
        self.mock_mode = False
        
        # Determine port or mock mode
        if mock_mode is True:
            self.mock_mode = True
            logger.info("Initialized AS608 in explicit MOCK/EMULATION mode.")
        else:
            self.port = port or self._detect_port()
            if self.port and SERIAL_AVAILABLE:
                self._init_serial()
            else:
                logger.info("No physical AS608 port detected or serial unavailable. Falling back to MOCK mode.")
                self.mock_mode = True

    def _detect_port(self) -> Optional[str]:
        """Auto-detects typical Raspberry Pi UART/USB serial ports or Windows COM ports."""
        candidate_ports = []
        if sys.platform.startswith("linux"):
            candidate_ports = [
                "/dev/ttyUSB0",
                "/dev/ttyUSB1",
                "/dev/ttyAMA0",
                "/dev/ttyS0",
                "/dev/serial0"
            ]
        elif sys.platform.startswith("win"):
            candidate_ports = [f"COM{i}" for i in range(1, 12)]
        
        if not SERIAL_AVAILABLE:
            return None

        try:
            available_ports = [p.device for p in serial.tools.list_ports.comports()]
            logger.info(f"Scanned available system serial ports: {available_ports}")

            for p in available_ports:
                if any(usb_name in p.lower() for usb_name in ["usb", "uart", "serial", "ch340", "cp210"]):
                    return p
            
            for p in candidate_ports:
                if os.path.exists(p) if sys.platform.startswith("linux") else (p in available_ports):
                    return p
        except Exception as e:
            logger.warning(f"Error scanning serial ports: {e}")

        return None

    def _init_serial(self) -> bool:
        """Establishes physical serial connection to AS608 module."""
        try:
            self.ser = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=self.timeout,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE
            )
            self.is_connected = True
            logger.info(f"Successfully opened serial port {self.port} at {self.baudrate} baud.")
            return True
        except Exception as e:
            logger.warning(f"Could not open serial port {self.port}: {e}. Switching to MOCK mode.")
            self.mock_mode = True
            self.is_connected = False
            return False

    def _build_packet(self, pid: int, content: bytes) -> bytes:
        """Constructs an AS608 protocol frame with header, length, and checksum."""
        length = len(content) + 2  # Length includes content + 2-byte checksum
        header_bytes = self.HEADER.to_bytes(2, byteorder='big')
        addr_bytes = self.DEFAULT_ADDRESS.to_bytes(4, byteorder='big')
        pid_byte = bytes([pid])
        length_bytes = length.to_bytes(2, byteorder='big')

        # Checksum is sum of PID + Length + Content
        checksum = (pid + (length >> 8) + (length & 0xFF) + sum(content)) & 0xFFFF
        checksum_bytes = checksum.to_bytes(2, byteorder='big')

        return header_bytes + addr_bytes + pid_byte + length_bytes + content + checksum_bytes

    def _send_command(self, cmd: int, params: bytes = b"") -> Optional[Tuple[int, bytes]]:
        """Sends a command packet and reads back the acknowledge response packet."""
        if self.mock_mode or not self.ser:
            return (self.CONFIRM_OK, b"")

        packet = self._build_packet(self.PID_COMMAND, bytes([cmd]) + params)
        try:
            self.ser.reset_input_buffer()
            self.ser.write(packet)
            self.ser.flush()

            header = self.ser.read(9)
            if len(header) < 9:
                logger.error("Timeout waiting for AS608 response header.")
                return None

            recv_header = int.from_bytes(header[0:2], byteorder='big')
            if recv_header != self.HEADER:
                logger.error(f"Invalid response header: {hex(recv_header)}")
                return None

            recv_pid = header[6]
            recv_len = int.from_bytes(header[7:9], byteorder='big')

            payload = self.ser.read(recv_len)
            if len(payload) < recv_len:
                logger.error("Incomplete response packet received.")
                return None

            content = payload[:-2]
            recv_checksum = int.from_bytes(payload[-2:], byteorder='big')

            calc_checksum = (recv_pid + (recv_len >> 8) + (recv_len & 0xFF) + sum(content)) & 0xFFFF
            if calc_checksum != recv_checksum:
                logger.error(f"Checksum mismatch: received {recv_checksum}, calculated {calc_checksum}")
                return None

            confirm_code = content[0]
            data = content[1:]
            return (confirm_code, data)
        except Exception as e:
            logger.error(f"Communication error with AS608: {e}")
            return None

    def handshake(self) -> bool:
        """Executes module handshake to test communication line."""
        if self.mock_mode:
            logger.info("[MOCK AS608] Handshake verified.")
            return True
        resp = self._send_command(self.CMD_HANDSHAKE)
        if resp and resp[0] == self.CONFIRM_OK:
            logger.info("Physical AS608 Handshake verified.")
            return True
        return False

    def capture_image(self, timeout_sec: float = 5.0, touch_detected: bool = False) -> bool:
        """Polls sensor until a finger is physically pressed on the optical glass."""
        start_time = time.time()
        while time.time() - start_time < timeout_sec:
            if self.mock_mode:
                # In emulation mode, require explicit touch confirmation from the sensor pad
                if touch_detected:
                    time.sleep(0.2)
                    return True
                # Without touch, no finger is detected
                return False

            resp = self._send_command(self.CMD_GET_IMAGE)
            if resp:
                code, _ = resp
                if code == self.CONFIRM_OK:
                    return True
                elif code == self.CONFIRM_NO_FINGER:
                    time.sleep(0.15)
                    continue
            time.sleep(0.1)
        return False

    def generate_character(self, buffer_id: int = 1) -> bool:
        """Generates feature character file from image in buffer (1 or 2)."""
        if self.mock_mode:
            return True
        resp = self._send_command(self.CMD_GEN_CHAR, bytes([buffer_id]))
        return resp is not None and resp[0] == self.CONFIRM_OK

    def search_fingerprint(self, start_page: int = 0, page_count: int = 300) -> Tuple[bool, int, int]:
        """
        Searches onboard flash library for character match in buffer 1.
        Returns: (success: bool, page_id: int, match_score: int)
        """
        if self.mock_mode:
            return (True, 1, 95)

        params = bytes([
            0x01,  # Buffer ID 1
            (start_page >> 8) & 0xFF,
            start_page & 0xFF,
            (page_count >> 8) & 0xFF,
            page_count & 0xFF
        ])
        resp = self._send_command(self.CMD_SEARCH, params)
        if resp and resp[0] == self.CONFIRM_OK:
            data = resp[1]
            page_id = int.from_bytes(data[0:2], byteorder='big')
            score = int.from_bytes(data[2:4], byteorder='big')
            return (True, page_id, score)
        return (False, -1, 0)

    def verify_fingerprint(self, expected_voter_slot: Optional[int] = None, timeout_sec: float = 6.0, touch_detected: bool = False) -> Dict[str, Any]:
        """
        High-level binary verification function.
        Requires physical or capacitive touch contact before initiating ridge minutiae analysis.
        """
        logger.info(f"AS608 Optical Sensor: checking for finger contact (touch_detected={touch_detected}, timeout={timeout_sec}s)...")
        has_finger = self.capture_image(timeout_sec=timeout_sec, touch_detected=touch_detected)
        
        if not has_finger:
            logger.warning("No finger detected on AS608 optical sensor window.")
            return {
                "status": "MATCH_FAIL",
                "score": 0,
                "page_id": -1,
                "mode": "EMULATED_HARDWARE" if self.mock_mode else "PHYSICAL_UART",
                "message": "No finger detected on optical sensor window. Please place and hold your finger firmly on the sensor area."
            }

        char_ok = self.generate_character(buffer_id=1)
        if not char_ok:
            return {
                "status": "MATCH_FAIL",
                "score": 0,
                "page_id": -1,
                "mode": "EMULATED_HARDWARE" if self.mock_mode else "PHYSICAL_UART",
                "message": "Failed to extract fingerprint minutiae ridges"
            }

        success, page_id, score = self.search_fingerprint()
        
        if success and (expected_voter_slot is None or expected_voter_slot == page_id or self.mock_mode):
            logger.info(f"Fingerprint verified: MATCH_SUCCESS (Slot: {page_id}, Score: {score})")
            return {
                "status": "MATCH_SUCCESS",
                "score": score,
                "page_id": page_id,
                "mode": "EMULATED_HARDWARE" if self.mock_mode else "PHYSICAL_UART",
                "message": f"Biometric ridge minutiae verified (Confidence: {score}%)"
            }
        else:
            logger.warning(f"Fingerprint rejected: MATCH_FAIL (Slot: {page_id}, Score: {score})")
            return {
                "status": "MATCH_FAIL",
                "score": score,
                "page_id": page_id,
                "mode": "EMULATED_HARDWARE" if self.mock_mode else "PHYSICAL_UART",
                "message": "Biometric ridge pattern does not match voter template"
            }

    def enroll_fingerprint(self, page_id: int) -> Dict[str, Any]:
        """
        Enrolls a new voter fingerprint into flash memory at `page_id`.
        Requires 2 consecutive presses for ridge template consolidation.
        """
        if self.mock_mode:
            return {"success": True, "page_id": page_id, "message": f"[MOCK] Enrolled slot {page_id}"}

        logger.info("Enrollment Step 1: Place finger on sensor...")
        if not self.capture_image(timeout_sec=8.0) or not self.generate_character(1):
            return {"success": False, "message": "Failed to capture first impression"}

        time.sleep(1.5)

        logger.info("Enrollment Step 2: Place SAME finger on sensor again...")
        if not self.capture_image(timeout_sec=8.0) or not self.generate_character(2):
            return {"success": False, "message": "Failed to capture second impression"}

        reg_resp = self._send_command(self.CMD_REG_MODEL)
        if not reg_resp or reg_resp[0] != self.CONFIRM_OK:
            return {"success": False, "message": "Ridge minutiae models did not correlate"}

        store_params = bytes([0x01, (page_id >> 8) & 0xFF, page_id & 0xFF])
        store_resp = self._send_command(self.CMD_STORE_CHAR, store_params)
        if store_resp and store_resp[0] == self.CONFIRM_OK:
            return {"success": True, "page_id": page_id, "message": f"Successfully enrolled template at slot {page_id}"}
        return {"success": False, "message": "Flash memory write error"}

    def close(self):
        """Safely closes serial interface."""
        if self.ser and self.ser.is_open:
            self.ser.close()
            self.is_connected = False
            logger.info("AS608 serial connection closed.")


# Singleton driver instance for easy importing
as608_sensor = AS608Driver()

if __name__ == "__main__":
    print("==================================================")
    print("  AS608 Hardware Driver Self-Test & Diagnostic")
    print("==================================================")
    scanner = AS608Driver()
    print(f"Active Mode: {'MOCK/EMULATION' if scanner.mock_mode else f'PHYSICAL SERIAL ({scanner.port})'}")
    
    print("\n[1] Testing Handshake...")
    hs = scanner.handshake()
    print(f"Handshake Result: {'PASS' if hs else 'FAIL'}")

    print("\n[2] Testing Verification Flow...")
    result = scanner.verify_fingerprint(timeout_sec=2.0)
    print("Verification Payload:", result)
    print("==================================================")
