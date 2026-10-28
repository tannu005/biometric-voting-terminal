import os
import time
import hmac
import queue
import threading
from pathlib import Path
from typing import Dict, Any, Optional
import serial
import uvicorn
from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

HOST = os.environ.get('PI_HOST', '0.0.0.0')
PORT = int(os.environ.get('PI_PORT', 8000))
TOKEN = os.environ.get('EVM_DEVICE_TOKEN', 'EVM-DEVICE-SECURE-LAN-TOKEN')

FINGERPRINT_PORT = os.environ.get('FINGERPRINT_PORT', '/dev/ttyS0')
FINGERPRINT_BAUD = int(os.environ.get('FINGERPRINT_BAUD', 57600))
BUTTON_PINS = {
    'switch_1': int(os.environ.get('PIN_SWITCH_1', 17)),
    'switch_2': int(os.environ.get('PIN_SWITCH_2', 27)),
    'switch_3': int(os.environ.get('PIN_SWITCH_3', 22)),
}
PHOTO_PATH = Path('/tmp/evm_capture.jpg')
try:
    PHOTO_PATH.parent.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

agent_app = FastAPI(title='EVM Hardware Agent')
events = queue.Queue()
hardware_lock = threading.Lock()

lcd = None
def init_lcd():
    global lcd
    try:
        if lcd is not None:
            try:
                lcd.close(clear=False)
            except Exception:
                pass
        from RPLCD.i2c import CharLCD
        lcd = CharLCD('PCF8574', address=0x27, port=1, cols=16, rows=2, auto_linebreaks=False)
        time.sleep(0.05)
        print('I2C LCD display initialized.')
        return True
    except Exception as exc:
        print('LCD display unavailable:', exc)
        return False

init_lcd()

def show_message(message: str):
    global lcd
    message = str(message or '')
    print(f'[LCD] {message.replace(chr(10), " | ")}')
    if lcd is None:
        return

    with hardware_lock:
        try:
            lines = message.split('\n')
            l1 = lines[0][:16] if len(lines) > 0 else ''
            l2 = lines[1][:16] if len(lines) > 1 else (message[16:32] if len(message) > 16 else '')
            # Pad exactly 16 characters per line - avoids clear() execution delay dropped-nibble bug
            l1_fixed = f"{l1:<16}"[:16]
            l2_fixed = f"{l2:<16}"[:16]

            lcd.cursor_pos = (0, 0)
            lcd.write_string(l1_fixed)
            lcd.cursor_pos = (1, 0)
            lcd.write_string(l2_fixed)
        except Exception as exc:
            print('LCD write error, reinitializing:', exc)
            try:
                init_lcd()
            except Exception:
                pass

finger = None
finger_init_error = None
connected_port = None
connected_baud = None

def patch_adafruit_fingerprint(sensor_obj):
    import struct
    original_send = sensor_obj._send_packet

    def robust_send_packet(data):
        uart = getattr(sensor_obj, '_uart', getattr(sensor_obj, 'uart', None))
        if uart and hasattr(uart, 'reset_input_buffer'):
            try:
                uart.reset_input_buffer()
            except Exception:
                pass
        return original_send(data)

    def robust_get_packet(expected: int):
        uart = getattr(sensor_obj, '_uart', getattr(sensor_obj, 'uart', None))
        if not uart:
            raise RuntimeError("UART interface unavailable on fingerprint sensor")
        start_time = time.monotonic()
        timeout = getattr(uart, 'timeout', 2.5) or 2.5

        # 1. Slide through stream to synchronize on start code 0xEF01
        header = bytearray()
        while time.monotonic() - start_time < timeout:
            b = uart.read(1)
            if not b:
                continue
            header += b
            if len(header) >= 2:
                if header[-2:] == b'\xef\x01':
                    break
                header = header[-1:]
        else:
            raise RuntimeError("Sensor packet timeout: 0xEF01 header not found")

        # 2. Read remaining (expected - 2) bytes
        needed = expected - 2
        rest = bytearray()
        while len(rest) < needed and (time.monotonic() - start_time < timeout):
            chunk = uart.read(needed - len(rest))
            if chunk:
                rest += chunk
            else:
                time.sleep(0.005)

        if len(rest) < needed:
            raise RuntimeError(f"Sensor packet incomplete: got {len(rest)} of {needed} bytes")

        res = b'\xef\x01' + bytes(rest)
        addr = list(res[2:6])
        if addr != sensor_obj.address:
            raise RuntimeError(f"Incorrect address: {addr}")
        packet_type, length = struct.unpack(">BH", res[6:9])
        if packet_type != 0x07:
            raise RuntimeError(f"Incorrect packet type {packet_type}")

        reply = list(res[9 : 9 + (length - 2)])
        return reply

    sensor_obj._send_packet = robust_send_packet
    sensor_obj._get_packet = robust_get_packet

def init_fingerprint(forced_port=None, forced_baud=None):
    global finger, finger_init_error, connected_port, connected_baud
    import glob

    try:
        import adafruit_fingerprint
    except Exception as exc:
        finger_init_error = f'adafruit_fingerprint module missing: {exc}'
        print(finger_init_error)
        return {'ok': False, 'error': finger_init_error}

    if finger is not None:
        try:
            uart = getattr(finger, '_uart', getattr(finger, 'uart', None))
            if uart:
                uart.close()
        except Exception:
            pass
        finger = None

    candidate_ports = []
    if forced_port:
        candidate_ports.append(forced_port)
    elif os.environ.get('FINGERPRINT_PORT'):
        candidate_ports.append(os.environ.get('FINGERPRINT_PORT'))

    # Prioritize USB-UART adapters first (e.g. /dev/ttyUSB0)
    for usb_dev in glob.glob('/dev/ttyUSB*') + glob.glob('/dev/ttyACM*'):
        if usb_dev not in candidate_ports and os.path.exists(usb_dev):
            candidate_ports.append(usb_dev)

    for p in ['/dev/serial0', '/dev/ttyUSB0', '/dev/ttyUSB1', '/dev/ttyACM0', '/dev/ttyAMA0', '/dev/ttyS0']:
        if p not in candidate_ports and os.path.exists(p):
            candidate_ports.append(p)

    if not candidate_ports:
        candidate_ports = ['/dev/ttyUSB0', '/dev/serial0', '/dev/ttyS0']

    candidate_bauds = [forced_baud] if forced_baud else [57600, 9600, 115200]
    errors = {}

    for port in candidate_ports:
        if not os.path.exists(port):
            errors[port] = 'Device file not found'
            continue
        for baud in candidate_bauds:
            uart = None
            try:
                uart = serial.Serial(port, baudrate=baud, timeout=2.0)
                if hasattr(uart, 'reset_input_buffer'):
                    uart.reset_input_buffer()
                if hasattr(uart, 'reset_output_buffer'):
                    uart.reset_output_buffer()
                time.sleep(0.15)
                f = adafruit_fingerprint.Adafruit_Fingerprint(uart)
                patch_adafruit_fingerprint(f)
                finger = f
                finger_init_error = None
                connected_port = port
                connected_baud = baud
                print(f'✓ R307S Fingerprint sensor connected on {port} @ {baud} baud.')
                return {
                    'ok': True,
                    'port': port,
                    'baud': baud,
                    'message': f'Sensor connected on {port} @ {baud} baud'
                }
            except Exception as e:
                errors[f'{port}@{baud}'] = str(e)
                if uart:
                    try:
                        uart.close()
                    except Exception:
                        pass

    finger_init_error = f'Sensor not responding on tested ports: {errors}'
    print('Fingerprint sensor scan failed:', finger_init_error)
    return {
        'ok': False,
        'errors': errors,
        'candidate_ports': candidate_ports
    }

init_fingerprint()

camera = None
camera_type = None
camera_error = None
try:
    from picamera2 import Picamera2
    camera = Picamera2()
    camera.configure(camera.create_still_configuration())
    camera.start()
    time.sleep(1)
    camera_type = 'picamera2'
    print('Pi Camera (Picamera2) initialized.')
except Exception as exc:
    try:
        import cv2
        cap = cv2.VideoCapture(0)
        if cap.isOpened():
            camera = cap
            camera_type = 'opencv'
            print('USB/V4L2 Camera (OpenCV) initialized.')
        else:
            camera_error = str(exc)
            print('Camera unavailable:', exc)
    except Exception as exc2:
        camera_error = f'{exc}; {exc2}'
        print('Camera unavailable:', exc)

buttons = {}
def make_callback(name):
    def on_pressed():
        event = {
            'type': 'switch_pressed',
            'switch': name,
            'timestamp': time.time(),
        }
        events.put(event)
        print('Physical switch event:', event)
    return on_pressed

try:
    from gpiozero import Button
    for name, pin in BUTTON_PINS.items():
        try:
            button = Button(pin, pull_up=True, bounce_time=0.15)
            button.when_pressed = make_callback(name)
            buttons[name] = button
            print(f'Switch {name} configured on BCM GPIO {pin}.')
        except Exception as exc:
            print(f'Could not initialize {name} on GPIO {pin}:', exc)
except Exception as exc:
    print('gpiozero not available for switches:', exc)

def authorize(x_device_token: str = Header(default='')):
    if not TOKEN:
        return True
    if not hmac.compare_digest(x_device_token, TOKEN):
        raise HTTPException(status_code=401, detail='Unauthorized device token')
    return True

class DisplayRequest(BaseModel):
    message: str

class FingerprintEnrollRequest(BaseModel):
    slot: int


@agent_app.get('/health')
def health(_auth: bool = Depends(authorize)):
    return {
        'device': 'raspberry_pi',
        'status': 'READY',
        'fingerprint_ready': finger is not None,
        'fingerprint_error': finger_init_error,
        'fingerprint_port': connected_port,
        'fingerprint_baud': connected_baud,
        'camera_ready': camera is not None,
        'camera_type': camera_type,
        'camera_error': camera_error,
        'lcd_ready': lcd is not None,
        'switches_ready': list(buttons.keys()),
        'timestamp': time.time()
    }

@agent_app.api_route('/fingerprint/reconnect', methods=['GET', 'POST'])
def reconnect_fingerprint(port: Optional[str] = None, baud: Optional[int] = None, _auth: bool = Depends(authorize)):
    with hardware_lock:
        res = init_fingerprint(forced_port=port, forced_baud=baud)
    return res

@agent_app.get('/fingerprint/diagnostic')
def diagnostic_fingerprint(_auth: bool = Depends(authorize)):
    import glob
    available_devices = {
        'dev_serial': glob.glob('/dev/serial*'),
        'dev_ttyUSB': glob.glob('/dev/ttyUSB*'),
        'dev_ttyACM': glob.glob('/dev/ttyACM*'),
        'dev_ttyAMA': glob.glob('/dev/ttyAMA*'),
        'dev_ttyS': glob.glob('/dev/ttyS*'),
    }
    return {
        'fingerprint_ready': finger is not None,
        'connected_port': connected_port,
        'connected_baud': connected_baud,
        'error': finger_init_error,
        'available_devices': available_devices
    }

@agent_app.post('/display')
def display(request: DisplayRequest, _auth: bool = Depends(authorize)):
    show_message(request.message)
    return {'ok': True, 'message': request.message}

@agent_app.api_route('/display/reset', methods=['GET', 'POST'])
def reset_display(_auth: bool = Depends(authorize)):
    init_lcd()
    show_message('EVM Terminal\nEnter Voter ID')
    return {'ok': True, 'message': 'LCD display reset and resynchronized'}

def safe_get_image(timeout_sec: float = 20.0) -> bool:
    global finger
    deadline = time.monotonic() + timeout_sec
    import adafruit_fingerprint
    while time.monotonic() < deadline:
        if finger is None:
            init_fingerprint()
            if finger is None:
                time.sleep(0.5)
                continue
        try:
            res = finger.get_image()
            if res == adafruit_fingerprint.OK:
                return True
        except Exception:
            time.sleep(0.1)
        time.sleep(0.15)
    return False

@agent_app.post('/fingerprint/match')
def fingerprint_match(_auth: bool = Depends(authorize)):
    global finger
    if finger is None:
        with hardware_lock:
            init_fingerprint()

    if finger is None:
        raise HTTPException(
            status_code=503,
            detail=f'Fingerprint sensor unavailable: {finger_init_error}',
        )

    with hardware_lock:
        import adafruit_fingerprint
        show_message('Place your finger' + chr(10) + 'on sensor...')

        if not safe_get_image(timeout_sec=20.0):
            show_message('Scan timeout' + chr(10) + 'Try again')
            return {'matched': False, 'reason': 'timeout', 'message': 'Scan timed out. Place finger firmly on sensor.'}

        try:
            res = finger.image_2_tz(1)
            if res != adafruit_fingerprint.OK:
                show_message('Feature error' + chr(10) + 'Try again')
                return {'matched': False, 'reason': 'could_not_extract_features', 'sensor_code': res, 'message': 'Could not extract features. Place finger flat.'}

            res = finger.finger_search()
            if res == adafruit_fingerprint.OK:
                show_message(f'Match Confirmed' + chr(10) + f'Slot #{int(finger.finger_id)}')
                score_val = min(100, int(finger.confidence * 100 / 200)) if finger.confidence > 0 else 92
                return {
                    'matched': True,
                    'template_id': int(finger.finger_id),
                    'confidence': int(finger.confidence),
                    'score': score_val
                }
            if res == adafruit_fingerprint.NOTFOUND:
                show_message('No Match Found' + chr(10) + 'Rejected')
                return {'matched': False, 'reason': 'no_template_match', 'message': 'No matching fingerprint found in sensor memory.'}
        except Exception as exc:
            return {'matched': False, 'reason': f'Sensor read error: {exc}', 'message': str(exc)}

        return {'matched': False, 'reason': f'Search code {res}', 'message': f'Sensor return code {res}'}

@agent_app.post('/fingerprint/enroll')
def fingerprint_enroll(req: FingerprintEnrollRequest, _auth: bool = Depends(authorize)):
    global finger
    slot = req.slot
    if finger is None:
        with hardware_lock:
            init_fingerprint()

    if finger is None:
        return {
            'enrolled': False,
            'slot': slot,
            'mode': 'OFFLINE',
            'message': f'R307S Fingerprint sensor is offline: {finger_init_error}'
        }

    with hardware_lock:
        import adafruit_fingerprint

        err_msgs = {
            adafruit_fingerprint.IMAGEMESS: 'Fingerprint image too blurry/messy. Press firmly and flatly.',
            adafruit_fingerprint.FEATUREFAIL: 'Too few minutiae points detected. Ensure finger is centered.',
            adafruit_fingerprint.ENROLLMISMATCH: 'Two touches did not match. Please use the exact same finger.',
            adafruit_fingerprint.BADLOCATION: f'Invalid slot #{slot}. Valid range is 1-127.',
            adafruit_fingerprint.FLASHERR: 'Sensor flash storage error.',
        }

        # Step 1: First finger touch
        show_message(f'Enroll Slot #{slot}' + chr(10) + 'Place Finger...')
        print(f'[ENROLL] Waiting for first touch on slot #{slot}...')
        if not safe_get_image(timeout_sec=20.0):
            show_message('Enroll Timeout' + chr(10) + 'Try Again')
            return {'enrolled': False, 'reason': 'timeout_finger_1', 'message': 'First touch timed out. Place finger firmly on sensor glass.'}

        try:
            res = finger.image_2_tz(1)
        except Exception as e:
            return {'enrolled': False, 'reason': 'feature_err_1', 'message': f'Minutiae read error: {e}'}

        if res != adafruit_fingerprint.OK:
            msg = err_msgs.get(res, f'Feature extraction failed (code {res}). Place finger flat.')
            show_message('Feature Error' + chr(10) + 'Try Again')
            return {'enrolled': False, 'reason': f'feature_extraction_failed_1_{res}', 'message': msg}

        # Step 2: Remove finger
        show_message('Remove Finger...' + chr(10) + 'Wait 2 secs')
        release_deadline = time.monotonic() + 3.0
        while time.monotonic() < release_deadline:
            try:
                if finger.get_image() == adafruit_fingerprint.NOFINGER:
                    break
            except Exception:
                pass
            time.sleep(0.2)
        time.sleep(1.0)

        # Step 3: Second confirmation touch
        show_message('Place Again' + chr(10) + 'Same Finger...')
        print(f'[ENROLL] Waiting for confirmation touch on slot #{slot}...')
        if not safe_get_image(timeout_sec=20.0):
            show_message('Enroll Timeout' + chr(10) + 'Try Again')
            return {'enrolled': False, 'reason': 'timeout_finger_2', 'message': 'Second confirmation touch timed out. Try again.'}

        try:
            res = finger.image_2_tz(2)
        except Exception as e:
            return {'enrolled': False, 'reason': 'feature_err_2', 'message': f'Minutiae read error: {e}'}

        if res != adafruit_fingerprint.OK:
            msg = err_msgs.get(res, f'Second feature extraction failed (code {res}).')
            show_message('Feature Error' + chr(10) + 'Try Again')
            return {'enrolled': False, 'reason': f'feature_extraction_failed_2_{res}', 'message': msg}

        # Step 4: Model creation and flash burn
        try:
            res = finger.create_model()
            if res != adafruit_fingerprint.OK:
                msg = err_msgs.get(res, 'Prints did not match sufficiently. Use the exact same finger.')
                show_message('Prints Differ' + chr(10) + 'Enroll Failed')
                return {'enrolled': False, 'reason': 'prints_do_not_match', 'message': msg}

            res = finger.store_model(slot)
            if res != adafruit_fingerprint.OK:
                msg = err_msgs.get(res, f'Sensor storage failed (code {res}).')
                show_message('Store Failed' + chr(10) + f'Code: {res}')
                return {'enrolled': False, 'reason': f'store_failed_{res}', 'message': msg}
        except Exception as exc:
            return {'enrolled': False, 'reason': 'model_store_err', 'message': f'Store error: {exc}'}

        show_message(f'Slot #{slot} Stored' + chr(10) + 'Enroll Success!')
        print(f'✓ Successfully enrolled fingerprint into slot #{slot}!')
        return {
            'enrolled': True,
            'slot': slot,
            'mode': 'R307S_HARDWARE',
            'message': f'Fingerprint burned to R307S hardware slot #{slot}'
        }

@agent_app.api_route('/camera/capture', methods=['GET', 'POST'])
@agent_app.api_route('/camera/preview', methods=['GET', 'POST'])
def capture_camera(_auth: bool = Depends(authorize)):
    if camera is None:
        raise HTTPException(status_code=503, detail=f'Camera unavailable: {camera_error}')

    try:
        with hardware_lock:
            if camera_type == 'picamera2':
                camera.capture_file(str(PHOTO_PATH))
            elif camera_type == 'opencv':
                import cv2
                ret, frame = camera.read()
                if not ret:
                    raise RuntimeError('Failed to read frame from OpenCV camera')
                cv2.imwrite(str(PHOTO_PATH), frame)
            
            return FileResponse(
                str(PHOTO_PATH),
                media_type='image/jpeg',
                filename='voter_capture.jpg',
            )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Camera capture failed: {exc}')

@agent_app.get('/events')
def get_events(_auth: bool = Depends(authorize)):
    result = []
    while len(result) < 50:
        try:
            result.append(events.get_nowait())
        except queue.Empty:
            break
    return {'events': result}

@agent_app.on_event('shutdown')
def cleanup():
    for button in buttons.values():
        try:
            button.close()
        except Exception:
            pass
    if camera is not None:
        try:
            if camera_type == 'picamera2':
                camera.stop()
                camera.close()
            elif camera_type == 'opencv':
                camera.release()
        except Exception:
            pass
    if finger is not None:
        try:
            finger.uart.close()
        except Exception:
            pass
    if lcd is not None:
        try:
            lcd.close(clear=True)
        except Exception:
            pass

if __name__ == '__main__':
    print(f'Starting EVM Hardware Agent on {HOST}:{PORT}')
    uvicorn.run(agent_app, host=HOST, port=PORT)
