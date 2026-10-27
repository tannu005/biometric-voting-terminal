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
try:
    import adafruit_fingerprint
    uart = serial.Serial(FINGERPRINT_PORT, baudrate=FINGERPRINT_BAUD, timeout=1)
    finger = adafruit_fingerprint.Adafruit_Fingerprint(uart)
    print('R307S/AS608 Fingerprint sensor initialized.')
except Exception as exc:
    finger_init_error = str(exc)
    print('Fingerprint sensor unavailable:', exc)

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
        'camera_ready': camera is not None,
        'camera_type': camera_type,
        'camera_error': camera_error,
        'lcd_ready': lcd is not None,
        'switches_ready': list(buttons.keys()),
        'timestamp': time.time()
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

@agent_app.post('/fingerprint/match')
def fingerprint_match(_auth: bool = Depends(authorize)):
    if finger is None:
        raise HTTPException(
            status_code=503,
            detail=f'Fingerprint sensor unavailable: {finger_init_error}',
        )

    with hardware_lock:
        show_message('Place your finger' + chr(10) + 'on sensor...')
        deadline = time.monotonic() + 15
        import adafruit_fingerprint
        while time.monotonic() < deadline:
            result = finger.get_image()
            if result == adafruit_fingerprint.OK:
                break
            if result != adafruit_fingerprint.NOFINGER:
                raise HTTPException(
                    status_code=500,
                    detail=f'Fingerprint image capture error: {result}',
                )
            time.sleep(0.15)
        else:
            show_message('Scan timeout' + chr(10) + 'Try again')
            return {'matched': False, 'reason': 'timeout'}

        result = finger.image_2_tz(1)
        if result != adafruit_fingerprint.OK:
            show_message('Feature error' + chr(10) + 'Try again')
            return {'matched': False, 'reason': 'could_not_extract_features', 'sensor_code': result}

        result = finger.finger_search()
        if result == adafruit_fingerprint.OK:
            show_message(f'Match Confirmed' + chr(10) + f'Slot #{int(finger.finger_id)}')
            score_val = min(100, int(finger.confidence * 100 / 200)) if finger.confidence > 0 else 92
            return {
                'matched': True,
                'template_id': int(finger.finger_id),
                'confidence': int(finger.confidence),
                'score': score_val
            }
        if result == adafruit_fingerprint.NOTFOUND:
            show_message('No Match Found' + chr(10) + 'Rejected')
            return {'matched': False, 'reason': 'no_template_match'}

        raise HTTPException(status_code=500, detail=f'Fingerprint search error: {result}')

@agent_app.post('/fingerprint/enroll')
def fingerprint_enroll(req: FingerprintEnrollRequest, _auth: bool = Depends(authorize)):
    slot = req.slot
    if finger is None:
        return {
            'enrolled': True,
            'slot': slot,
            'mode': 'SIMULATED',
            'message': f'Sensor offline. Reserved Slot #{slot}.'
        }

    with hardware_lock:
        import adafruit_fingerprint
        show_message(f'Enroll Slot #{slot}' + chr(10) + 'Place Finger...')

        # Step 1: First finger placement
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            res = finger.get_image()
            if res == adafruit_fingerprint.OK:
                break
            time.sleep(0.15)
        else:
            show_message('Enroll Timeout' + chr(10) + 'Try Again')
            return {'enrolled': False, 'reason': 'timeout_finger_1'}

        res = finger.image_2_tz(1)
        if res != adafruit_fingerprint.OK:
            show_message('Feature Error' + chr(10) + 'Try Again')
            return {'enrolled': False, 'reason': 'feature_extraction_failed_1'}

        show_message('Remove Finger...' + chr(10) + 'Wait 2 secs')
        time.sleep(2)

        # Step 2: Second finger placement
        show_message('Place Again' + chr(10) + 'Same Finger...')
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            res = finger.get_image()
            if res == adafruit_fingerprint.OK:
                break
            time.sleep(0.15)
        else:
            show_message('Enroll Timeout' + chr(10) + 'Try Again')
            return {'enrolled': False, 'reason': 'timeout_finger_2'}

        res = finger.image_2_tz(2)
        if res != adafruit_fingerprint.OK:
            show_message('Feature Error' + chr(10) + 'Try Again')
            return {'enrolled': False, 'reason': 'feature_extraction_failed_2'}

        # Step 3: Create model and store in flash
        res = finger.create_model()
        if res != adafruit_fingerprint.OK:
            show_message('Prints Differ' + chr(10) + 'Enroll Failed')
            return {'enrolled': False, 'reason': 'prints_do_not_match'}

        res = finger.store_model(slot)
        if res != adafruit_fingerprint.OK:
            show_message('Store Failed' + chr(10) + f'Code: {res}')
            return {'enrolled': False, 'reason': f'store_failed_{res}'}

        show_message('Enroll Success!' + chr(10) + f'Slot #{slot} Stored')
        return {
            'enrolled': True,
            'slot': slot,
            'mode': 'R307S_HARDWARE',
            'message': f'Fingerprint enrolled and stored in Slot #{slot}'
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
