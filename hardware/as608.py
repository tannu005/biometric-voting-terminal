import os
import sys
import time
import logging
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger("as608")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False

class AS608Driver:
    HEADER = 0xEF01
    DEFAULT_ADDRESS = 0xFFFFFFFF

    PID_COMMAND = 0x01
    PID_DATA = 0x02
    PID_ACK = 0x07
    PID_END = 0x08

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
        
        if mock_mode is True:
            self.mock_mode = True
        else:
            self.port = port or self._detect_port()
            if self.port and SERIAL_AVAILABLE:
                self._init_serial()
            else:
                self.mock_mode = True

    def _detect_port(self) -> Optional[str]:
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
            for p in available_ports:
                if any(name in p.lower() for name in ["usb", "uart", "serial", "ch340", "cp210"]):
                    return p
            
            for p in candidate_ports:
                if os.path.exists(p) if sys.platform.startswith("linux") else (p in available_ports):
                    return p
        except Exception:
            pass

        return None

    def _init_serial(self) -> bool:
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
            return True
        except Exception:
            self.mock_mode = True
            self.is_connected = False
            return False

    def _build_packet(self, pid: int, content: bytes) -> bytes:
        length = len(content) + 2
        header_bytes = self.HEADER.to_bytes(2, byteorder='big')
        addr_bytes = self.DEFAULT_ADDRESS.to_bytes(4, byteorder='big')
        pid_byte = bytes([pid])
        length_bytes = length.to_bytes(2, byteorder='big')
        checksum = (pid + (length >> 8) + (length & 0xFF) + sum(content)) & 0xFFFF
        checksum_bytes = checksum.to_bytes(2, byteorder='big')

        return header_bytes + addr_bytes + pid_byte + length_bytes + content + checksum_bytes

    def _send_command(self, cmd: int, params: bytes = b"") -> Optional[Tuple[int, bytes]]:
        if self.mock_mode or not self.ser:
            return (self.CONFIRM_OK, b"")

        packet = self._build_packet(self.PID_COMMAND, bytes([cmd]) + params)
        try:
            self.ser.reset_input_buffer()
            self.ser.write(packet)
            self.ser.flush()

            header = self.ser.read(9)
            if len(header) < 9:
                return None

            recv_header = int.from_bytes(header[0:2], byteorder='big')
            if recv_header != self.HEADER:
                return None

            recv_pid = header[6]
            recv_len = int.from_bytes(header[7:9], byteorder='big')

            payload = self.ser.read(recv_len)
            if len(payload) < recv_len:
                return None

            content = payload[:-2]
            recv_checksum = int.from_bytes(payload[-2:], byteorder='big')

            calc_checksum = (recv_pid + (recv_len >> 8) + (recv_len & 0xFF) + sum(content)) & 0xFFFF
            if calc_checksum != recv_checksum:
                return None

            confirm_code = content[0]
            data = content[1:]
            return (confirm_code, data)
        except Exception:
            return None

    def handshake(self) -> bool:
        if self.mock_mode:
            return True
        resp = self._send_command(self.CMD_HANDSHAKE)
        return resp is not None and resp[0] == self.CONFIRM_OK

    def capture_image(self, timeout_sec: float = 5.0, touch_detected: bool = False) -> bool:
        start_time = time.time()
        while time.time() - start_time < timeout_sec:
            if self.mock_mode:
                if touch_detected:
                    time.sleep(0.2)
                    return True
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
        if self.mock_mode:
            return True
        resp = self._send_command(self.CMD_GEN_CHAR, bytes([buffer_id]))
        return resp is not None and resp[0] == self.CONFIRM_OK

    def search_fingerprint(self, start_page: int = 0, page_count: int = 300) -> Tuple[bool, int, int]:
        if self.mock_mode:
            return (True, 1, 95)

        params = bytes([
            0x01,
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
        has_finger = self.capture_image(timeout_sec=timeout_sec, touch_detected=touch_detected)
        
        if not has_finger:
            return {
                "status": "MATCH_FAIL",
                "score": 0,
                "page_id": -1,
                "mode": "EMULATED_HARDWARE" if self.mock_mode else "PHYSICAL_UART",
                "message": "No finger detected on sensor window."
            }

        char_ok = self.generate_character(buffer_id=1)
        if not char_ok:
            return {
                "status": "MATCH_FAIL",
                "score": 0,
                "page_id": -1,
                "mode": "EMULATED_HARDWARE" if self.mock_mode else "PHYSICAL_UART",
                "message": "Failed to extract fingerprint features."
            }

        success, page_id, score = self.search_fingerprint()
        
        if success and (expected_voter_slot is None or expected_voter_slot == page_id or self.mock_mode):
            return {
                "status": "MATCH_SUCCESS",
                "score": score,
                "page_id": page_id,
                "mode": "EMULATED_HARDWARE" if self.mock_mode else "PHYSICAL_UART",
                "message": f"Fingerprint verified ({score}%)"
            }
        else:
            return {
                "status": "MATCH_FAIL",
                "score": score,
                "page_id": page_id,
                "mode": "EMULATED_HARDWARE" if self.mock_mode else "PHYSICAL_UART",
                "message": "Fingerprint does not match record."
            }

    def enroll_fingerprint(self, page_id: int) -> Dict[str, Any]:
        if self.mock_mode:
            return {"success": True, "page_id": page_id, "message": f"Enrolled slot {page_id}"}

        if not self.capture_image(timeout_sec=8.0) or not self.generate_character(1):
            return {"success": False, "message": "Failed to capture first impression"}

        time.sleep(1.5)

        if not self.capture_image(timeout_sec=8.0) or not self.generate_character(2):
            return {"success": False, "message": "Failed to capture second impression"}

        reg_resp = self._send_command(self.CMD_REG_MODEL)
        if not reg_resp or reg_resp[0] != self.CONFIRM_OK:
            return {"success": False, "message": "Minutiae models did not correlate"}

        store_params = bytes([0x01, (page_id >> 8) & 0xFF, page_id & 0xFF])
        store_resp = self._send_command(self.CMD_STORE_CHAR, store_params)
        if store_resp and store_resp[0] == self.CONFIRM_OK:
            return {"success": True, "page_id": page_id, "message": f"Enrolled template at slot {page_id}"}
        return {"success": False, "message": "Flash memory write error"}

    def close(self):
        if self.ser and self.ser.is_open:
            self.ser.close()
            self.is_connected = False

as608_sensor = AS608Driver()