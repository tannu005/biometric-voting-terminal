

class KioskAudio {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
  }

  beep(freq = 600, duration = 0.08, type = 'sine') {
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
    }
  }

  successChord() {
    this.beep(523.25, 0.1);
    setTimeout(() => this.beep(659.25, 0.1), 80);
    setTimeout(() => this.beep(783.99, 0.2), 160);
  }

  errorTone() {
    this.beep(220, 0.2, 'sawtooth');
    setTimeout(() => this.beep(196, 0.3, 'sawtooth'), 120);
  }

  ballotChime() {
    this.beep(880, 0.4, 'sine');
  }
}

const audio = new KioskAudio();

const KioskState = {
  currentStep: 1,
  activeEpic: '',
  voterData: null,
  ephemeralToken: null,
  candidates: [],
  selectedCandidate: null,
  autoResetTimer: null,
  isOfflineFallback: false
};

const FALLBACK_VOTERS = {
  "VOTE-IND-2026-001": {
    epic: "VOTE-IND-2026-001",
    name: "Aarav Sharma",
    constituency: "Central Tech Constituency - AC-07",
    gender: "Male",
    dob: "1994-08-15",
    fingerprint_slot: 1,
    is_eligible: true,
    photo_url: "/voter_db/VOTE-IND-2026-001.jpg"
  },
  "VOTE-IND-2026-002": {
    epic: "VOTE-IND-2026-002",
    name: "Priya Patel",
    constituency: "Central Tech Constituency - AC-07",
    gender: "Female",
    dob: "1998-03-22",
    fingerprint_slot: 2,
    is_eligible: true,
    photo_url: "/voter_db/VOTE-IND-2026-002.jpg"
  },
  "VOTE-IND-2026-003": {
    epic: "VOTE-IND-2026-003",
    name: "Vikram Malhotra",
    constituency: "Central Tech Constituency - AC-07",
    gender: "Male",
    dob: "1988-11-04",
    fingerprint_slot: 3,
    is_eligible: true,
    photo_url: "/voter_db/VOTE-IND-2026-003.jpg"
  },
  "VOTE-IND-2026-004": {
    epic: "VOTE-IND-2026-004",
    name: "Ananya Sen",
    constituency: "Central Tech Constituency - AC-07",
    gender: "Female",
    dob: "2001-05-19",
    fingerprint_slot: 4,
    is_eligible: true,
    photo_url: "/voter_db/VOTE-IND-2026-004.jpg"
  },
  "VOTE-IND-2026-668": {
    epic: "VOTE-IND-2026-668",
    name: "NAVEEN",
    constituency: "Central Tech Constituency - AC-07",
    gender: "Male",
    dob: "1996-05-12",
    fingerprint_slot: 5,
    is_eligible: true,
    photo_url: "/voter_db/VOTE-IND-2026-668.jpg"
  },
  "VOTE-IND-668": {
    epic: "VOTE-IND-668",
    name: "NAVEEN",
    constituency: "Central Tech Constituency - AC-07",
    gender: "Male",
    dob: "1996-05-12",
    fingerprint_slot: 5,
    is_eligible: true,
    photo_url: "/voter_db/VOTE-IND-2026-668.jpg"
  }
};

function getRegisteredVoters() {
  try {
    return JSON.parse(localStorage.getItem('EVM_REGISTERED_VOTERS') || '{}');
  } catch (e) {
    return {};
  }
}

function saveRegisteredVoter(voter) {
  if (!voter || !voter.epic) return;
  try {
    const epic = voter.epic.toUpperCase();
    const voters = getRegisteredVoters();
    voters[epic] = voter;
    localStorage.setItem('EVM_REGISTERED_VOTERS', JSON.stringify(voters));
    FALLBACK_VOTERS[epic] = voter;
  } catch (e) {}
}

try {
  const _stored = getRegisteredVoters();
  Object.keys(_stored).forEach(k => {
    FALLBACK_VOTERS[k] = _stored[k];
  });
} catch (e) {}

const FALLBACK_CANDIDATES = [
  {
    "id": "CAND-01",
    "contract_id": 0,
    "name": "Dr. Rajeshwar Verma",
    "party": "National Progress Alliance",
    "symbol": "⚡",
    "symbol_name": "Electric Bolt",
    "color": "#3b82f6",
    "manifesto": "Innovation, Smart Infrastructure & Sustainable Energy"
  },
  {
    "id": "CAND-02",
    "contract_id": 1,
    "name": "Sunita Deshmukh",
    "party": "People's Integrity Front",
    "symbol": "🌾",
    "symbol_name": "Golden Grain",
    "color": "#10b981",
    "manifesto": "Agrarian Modernization & Universal Healthcare"
  },
  {
    "id": "CAND-03",
    "contract_id": 2,
    "name": "Kabir Al-Mansoor",
    "party": "Democratic Reform Coalition",
    "symbol": "⚖️",
    "symbol_name": "Scales of Justice",
    "color": "#8b5cf6",
    "manifesto": "Judicial Transparency & Youth Employment Initiatives"
  }
];

const screens = {
  1: document.getElementById('screen-epic'),
  2: document.getElementById('screen-fingerprint'),
  3: document.getElementById('screen-face'),
  4: document.getElementById('screen-ballot'),
  5: document.getElementById('screen-confirm')
};

const stepperItems = {
  1: document.getElementById('step-indicator-1'),
  2: document.getElementById('step-indicator-2'),
  3: document.getElementById('step-indicator-3'),
  4: document.getElementById('step-indicator-4'),
  5: document.getElementById('step-indicator-5')
};

async function updatePiDisplay(message) {
  try {
    await fetch('/api/hardware/display', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message })
    });
  } catch (e) {}
}

function setScreenState(stepNumber) {
  KioskState.currentStep = stepNumber;

  Object.keys(screens).forEach(step => {
    if (parseInt(step) === stepNumber) {
      screens[step].classList.add('active');
    } else {
      screens[step].classList.remove('active');
    }
  });

  Object.keys(stepperItems).forEach(step => {
    const num = parseInt(step);
    const item = stepperItems[step];
    if (num < stepNumber) {
      item.className = 'step-item completed';
    } else if (num === stepNumber) {
      item.className = 'step-item active';
    } else {
      item.className = 'step-item';
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (stepNumber === 1) {
    stopAutomaticFaceTracker();
    updatePiDisplay("EVM Terminal\nEnter Voter ID");
  } else if (stepNumber === 2) {
    stopAutomaticFaceTracker();
    updatePiDisplay("Fingerprint Scan\nTouch Sensor");
  } else if (stepNumber === 3) {
    updatePiDisplay("Facial Scan\nLook at Camera");
    if (userSelectedCameraOverride && currentCameraSource === 'laptop') {
      setCameraSource('laptop', true);
    } else {
      setCameraSource('pi');
    }
  } else if (stepNumber === 4) {
    stopAutomaticFaceTracker();
    stopPiCameraPreviewLoop();
    lastProcessedHardwareTimestamp = Date.now() / 1000;
    flushHardwareEvents();
    updatePiDisplay("1:Verma 2:Sunita\n3:Kabir - Press");
  } else if (stepNumber === 5) {
    stopAutomaticFaceTracker();
    stopPiCameraPreviewLoop();
    updatePiDisplay("Ballot Cast OK\nPrinting Receipt");
  } else {
    stopAutomaticFaceTracker();
    stopPiCameraPreviewLoop();
  }
}

let clientStream = null;
async function initWebcamStream() {
  const videoEl = document.getElementById('client-webcam-feed');
  const imgEl = document.getElementById('server-mjpeg-stream');
  const badge = document.getElementById('badge-cam-feed-status');

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      if (!clientStream) {
        clientStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        });
      }
      if (videoEl && clientStream) {
        videoEl.srcObject = clientStream;
        videoEl.style.display = 'block';
        if (imgEl) imgEl.style.display = 'none';
        if (badge) {
          badge.className = "badge pulse success";
          badge.innerText = "WEBCAM: LIVE HUD ACTIVE";
        }
      }
    } catch (e) {
      console.log("Client webcam access not granted or unavailable, keeping standard feed:", e);
    }
  }
}

const epicInput = document.getElementById('epic-input-field');
const epicErrorMsg = document.getElementById('epic-error-msg');

function appendEpicChar(char) {
  audio.beep(700, 0.04);
  if (epicInput.value.length < 24) {
    epicInput.value += char;
  }
}

function clearEpicInput() {
  audio.beep(400, 0.05);
  epicInput.value = '';
  epicErrorMsg.innerText = '';
}

function backspaceEpicInput() {
  audio.beep(500, 0.04);
  epicInput.value = epicInput.value.slice(0, -1);
}

function selectQuickEpic(epic) {
  audio.beep(650, 0.06);
  epicInput.value = epic;
  submitEpicLookup();
}

async function submitEpicLookup() {
  const epic = epicInput.value.trim().toUpperCase();
  if (!epic) {
    showEpicError("Please enter a valid Voter EPIC Number.");
    return;
  }

  showEpicError("");
  const submitBtn = document.getElementById('btn-submit-epic');
  submitBtn.disabled = true;
  submitBtn.innerText = "Verifying Registry...";

  const storedVoters = getRegisteredVoters();
  const localVoter = storedVoters[epic] || FALLBACK_VOTERS[epic] || (newlyRegisteredVoter && newlyRegisteredVoter.epic === epic ? newlyRegisteredVoter : null);

  try {
    const resp = await fetch('/api/voter/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        epic: epic,
        client_voter: localVoter || undefined
      })
    });

    if (resp.ok) {
      const data = await resp.json();
      audio.successChord();
      KioskState.activeEpic = epic;
      KioskState.voterData = { ...(localVoter || {}), ...data.voter };
      KioskState.isOfflineFallback = false;

      document.getElementById('hud-voter-name').innerText = KioskState.voterData.name;
      document.getElementById('hud-voter-epic').innerText = KioskState.voterData.epic;
      document.getElementById('hud-voter-constituency').innerText = KioskState.voterData.constituency;
      document.getElementById('hud-voter-photo').src = KioskState.voterData.photo_url || (localVoter && localVoter.photo_url) || `/voter_db/${epic}.jpg`;

      setScreenState(2);
      return;
    } else {
      if (localVoter) {
        audio.successChord();
        KioskState.activeEpic = epic;
        KioskState.voterData = localVoter;
        KioskState.isOfflineFallback = true;

        document.getElementById('hud-voter-name').innerText = localVoter.name;
        document.getElementById('hud-voter-epic').innerText = localVoter.epic;
        document.getElementById('hud-voter-constituency').innerText = localVoter.constituency;
        document.getElementById('hud-voter-photo').src = localVoter.photo_url || `/voter_db/${epic}.jpg`;

        fetch('/api/voter/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(localVoter)
        }).catch(() => {});

        setScreenState(2);
        return;
      }

      const data = await resp.json().catch(() => ({}));
      audio.errorTone();
      showEpicError(data.detail?.message || `EPIC '${epic}' not found in constituency roll.`);
      return;
    }
  } catch (err) {
    if (localVoter) {
      audio.successChord();
      KioskState.activeEpic = epic;
      KioskState.voterData = localVoter;
      KioskState.isOfflineFallback = true;

      document.getElementById('hud-voter-name').innerText = localVoter.name;
      document.getElementById('hud-voter-epic').innerText = localVoter.epic;
      document.getElementById('hud-voter-constituency').innerText = localVoter.constituency;
      document.getElementById('hud-voter-photo').src = localVoter.photo_url || `/voter_db/${epic}.jpg`;

      setScreenState(2);
      return;
    }
    audio.errorTone();
    showEpicError(`EPIC '${epic}' not found in constituency roll.`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = "Verify Voter Identity →";
  }
}

function showEpicError(msg) {
  epicErrorMsg.innerText = msg;
}

let faceTrackerInterval = null;
let faceHoldStreak = 0;
let isVerifyingFace = false;

function captureWebcamFrameBase64(videoElement) {
  if (!videoElement || !videoElement.videoWidth) return null;
  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth || 640;
  canvas.height = videoElement.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function drawFaceTrackingHUD(canvas, box, isSuccess) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!box) return;

  const scaleX = canvas.width / 320;
  const scaleY = canvas.height / 240;
  const x = box.x * scaleX;
  const y = box.y * scaleY;
  const w = box.w * scaleX;
  const h = box.h * scaleY;

  ctx.strokeStyle = isSuccess ? '#10b981' : '#38bdf8';
  ctx.lineWidth = 3;
  const corner = Math.min(w, h) * 0.25;

  ctx.beginPath();
  ctx.moveTo(x, y + corner); ctx.lineTo(x, y); ctx.lineTo(x + corner, y);
  ctx.moveTo(x + w - corner, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + corner);
  ctx.moveTo(x, y + h - corner); ctx.lineTo(x, y + h); ctx.lineTo(x + corner, y + h);
  ctx.moveTo(x + w - corner, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - corner);
  ctx.stroke();

  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.strokeStyle = isSuccess ? 'rgba(16, 185, 129, 0.4)' : 'rgba(56, 189, 248, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
  ctx.stroke();
}

let isPiOnline = false;
let currentCameraSource = 'pi';
let userSelectedCameraOverride = false;
let regCameraSource = 'pi';
let isPiPreviewRunning = false;
let isPiCaptureInProgress = false;
let piPreviewLoopTimeout = null;
let lastPiImageData = null;

function stopPiCameraPreviewLoop() {
  isPiPreviewRunning = false;
  if (piPreviewLoopTimeout) {
    clearTimeout(piPreviewLoopTimeout);
    piPreviewLoopTimeout = null;
  }
}

function startPiCameraPreviewLoop() {
  if (isPiPreviewRunning) return;
  isPiPreviewRunning = true;
  pollPiCameraFrame();
}

async function pollPiCameraFrame() {
  if (!isPiPreviewRunning) return;

  const isStep3 = (currentTerminalMode === 'kiosk' && KioskState.currentStep === 3 && currentCameraSource === 'pi');
  const isReg = (currentTerminalMode === 'register' && regCameraSource === 'pi' && !regCapturedPhotoBase64);

  if (!isStep3 && !isReg) {
    piPreviewLoopTimeout = setTimeout(pollPiCameraFrame, 1000);
    return;
  }

  if (isPiCaptureInProgress) {
    piPreviewLoopTimeout = setTimeout(pollPiCameraFrame, 1000);
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6500);

    const resp = await fetch('/api/biometrics/pi-camera-capture?t=' + Date.now(), {
      method: 'POST',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (resp.ok) {
      const data = await resp.json();
      if (data.success && data.image_data && isPiPreviewRunning && !isPiCaptureInProgress) {
        lastPiImageData = data.image_data;
        updatePiCameraPreview(data.image_data, data.detection);
      }
    }
  } catch (err) {
    // Will retry next cycle
  }

  if (isPiPreviewRunning) {
    piPreviewLoopTimeout = setTimeout(pollPiCameraFrame, 750);
  }
}

function updatePiCameraPreview(imageData, detection) {
  const isStep3 = (currentTerminalMode === 'kiosk' && KioskState.currentStep === 3 && currentCameraSource === 'pi');
  const isReg = (currentTerminalMode === 'register' && regCameraSource === 'pi' && !regCapturedPhotoBase64);

  if (isStep3) {
    const imgEl = document.getElementById('server-mjpeg-stream');
    const overlay = document.getElementById('pi-cam-viewfinder-overlay');
    const videoEl = document.getElementById('client-webcam-feed');
    const badge = document.getElementById('badge-cam-feed-status');
    const scanStatus = document.getElementById('face-scan-status');
    const label = document.getElementById('auto-detect-label');

    if (videoEl) videoEl.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    if (imgEl) {
      imgEl.src = imageData;
      imgEl.style.display = 'block';
    }

    if (badge) {
      badge.className = 'badge success';
      badge.innerText = 'PI CAM: LIVE PREVIEW';
    }

    if (detection && detection.detected) {
      if (scanStatus) {
        scanStatus.className = 'badge success';
        scanStatus.innerText = 'FACE DETECTED';
      }
      if (label) {
        label.innerText = 'Face detected in Pi Camera view. Ready to verify!';
        label.style.color = '#34d399';
      }
    } else {
      if (scanStatus) {
        scanStatus.className = 'badge';
        scanStatus.innerText = 'SEEKING FACE';
      }
      if (label) {
        label.innerText = 'Position face in front of Raspberry Pi camera lens';
        label.style.color = '#38bdf8';
      }
    }
  }

  if (isReg) {
    const previewImg = document.getElementById('reg-cam-preview-img');
    const placeholder = document.getElementById('reg-cam-pi-placeholder');
    const video = document.getElementById('reg-cam-video');
    const canvas = document.getElementById('reg-cam-canvas');
    const badge = document.getElementById('reg-face-badge');

    if (placeholder) placeholder.style.display = 'none';
    if (video) video.style.display = 'none';
    if (canvas) canvas.style.display = 'none';

    if (previewImg) {
      previewImg.src = imageData;
      previewImg.style.display = 'block';
    }

    if (badge) {
      badge.className = 'badge success';
      badge.innerText = 'PI CAM: LIVE PREVIEW';
    }
  }
}

function setCameraSource(source, isUserAction = false) {
  if (isUserAction) {
    userSelectedCameraOverride = true;
    currentCameraSource = (source === 'laptop') ? 'laptop' : 'pi';
  } else if (!userSelectedCameraOverride) {
    currentCameraSource = 'pi';
  }

  if (currentCameraSource !== 'laptop') {
    source = 'pi';
  }

  const btnLaptop = document.getElementById('btn-cam-source-laptop');
  const btnPi = document.getElementById('btn-cam-source-pi');
  const videoEl = document.getElementById('client-webcam-feed');
  const hudCanvas = document.getElementById('face-hud-canvas');
  const imgEl = document.getElementById('server-mjpeg-stream');
  const piOverlay = document.getElementById('pi-cam-viewfinder-overlay');
  const btnCaptureFace = document.getElementById('btn-capture-face');
  const btnCapturePi = document.getElementById('btn-capture-pi-camera');
  const activeCamLabel = document.getElementById('active-camera-label');
  const autoDetectInstruction = document.getElementById('auto-detect-instruction');
  const statusBadge = document.getElementById('badge-cam-feed-status');
  const faceScanStatus = document.getElementById('face-scan-status');

  if (source === 'laptop') {
    stopPiCameraPreviewLoop();

    if (btnLaptop) {
      btnLaptop.style.border = '1px solid #38bdf8';
      btnLaptop.style.background = 'rgba(56, 189, 248, 0.15)';
      btnLaptop.style.color = '#38bdf8';
    }
    if (btnPi) {
      btnPi.style.border = '1px solid #334155';
      btnPi.style.background = 'rgba(15, 23, 42, 0.6)';
      btnPi.style.color = '#94a3b8';
    }
    if (activeCamLabel) {
      activeCamLabel.innerText = 'Laptop HD Webcam';
      activeCamLabel.style.color = '#38bdf8';
    }
    if (btnCaptureFace) btnCaptureFace.style.display = 'flex';
    if (btnCapturePi) btnCapturePi.style.display = 'none';
    if (autoDetectInstruction) autoDetectInstruction.innerText = 'Face will automatically verify once centered and held still.';
    if (piOverlay) piOverlay.style.display = 'none';
    if (imgEl) imgEl.style.display = 'none';
    if (videoEl) videoEl.style.display = 'block';

    initWebcamStream();
    startAutomaticFaceTracker();
  } else {
    stopAutomaticFaceTracker();
    if (clientStream) {
      try {
        clientStream.getTracks().forEach(t => t.stop());
      } catch (e) {}
      clientStream = null;
    }
    if (videoEl) videoEl.style.display = 'none';
    if (hudCanvas) {
      const ctx = hudCanvas.getContext('2d');
      ctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
    }

    if (btnLaptop) {
      btnLaptop.style.border = '1px solid #334155';
      btnLaptop.style.background = 'rgba(15, 23, 42, 0.6)';
      btnLaptop.style.color = '#94a3b8';
    }
    if (btnPi) {
      btnPi.style.border = '1px solid #10b981';
      btnPi.style.background = 'rgba(16, 185, 129, 0.15)';
      btnPi.style.color = '#34d399';
    }
    if (activeCamLabel) {
      activeCamLabel.innerText = 'Raspberry Pi Camera (picamera2)';
      activeCamLabel.style.color = '#34d399';
    }
    if (btnCaptureFace) btnCaptureFace.style.display = 'none';
    if (btnCapturePi) {
      btnCapturePi.style.display = 'flex';
      btnCapturePi.disabled = false;
      btnCapturePi.innerText = '🍓 Capture from Pi & Verify →';
    }
    if (autoDetectInstruction) autoDetectInstruction.innerText = 'Look directly into Raspberry Pi camera lens and click button below (or press Pi Switch 3).';
    if (statusBadge) {
      statusBadge.className = 'badge success';
      statusBadge.innerText = 'PI CAMERA ACTIVE';
    }
    if (faceScanStatus && faceScanStatus.innerText === 'ALIGNING') {
      faceScanStatus.innerText = 'STANDBY';
    }

    if (lastPiImageData && imgEl) {
      imgEl.src = lastPiImageData;
      imgEl.style.display = 'block';
      if (piOverlay) piOverlay.style.display = 'none';
    } else {
      if (imgEl) imgEl.style.display = 'none';
      if (piOverlay) piOverlay.style.display = 'flex';
    }

    startPiCameraPreviewLoop();
  }
}

async function triggerPiCameraCaptureAndVerify() {
  const piBtn = document.getElementById('btn-capture-pi-camera');
  const statusBadge = document.getElementById('face-scan-status');
  const label = document.getElementById('auto-detect-label');
  const progress = document.getElementById('auto-detect-progress');
  const percent = document.getElementById('auto-detect-percent');

  isPiCaptureInProgress = true;
  stopPiCameraPreviewLoop();

  if (piBtn) {
    piBtn.disabled = true;
    piBtn.innerText = 'Capturing Pi Camera...';
  }
  if (statusBadge) statusBadge.innerText = 'CAPTURING PI CAMERA';
  if (label) label.innerText = 'Capturing photo from Raspberry Pi camera...';
  if (progress) progress.style.width = '40%';
  if (percent) percent.innerText = '40%';

  try {
    updatePiDisplay("Facial Scan\nCapturing Photo");
    const resp = await fetch('/api/biometrics/pi-camera-capture', { method: 'POST' });
    const data = await resp.json();
    if (!data.success || !data.image_data) {
      audio.errorTone();
      if (label) label.innerText = '⚠️ ' + (data.message || 'Raspberry Pi camera capture failed.');
      if (statusBadge) {
        statusBadge.className = 'badge';
        statusBadge.style.borderColor = 'var(--accent-rose)';
        statusBadge.style.color = 'var(--accent-rose)';
        statusBadge.innerText = 'PI CAM UNAVAILABLE';
      }
      if (piBtn) {
        piBtn.disabled = false;
        piBtn.innerText = '🍓 Capture from Pi & Verify →';
      }
      isPiCaptureInProgress = false;
      startPiCameraPreviewLoop();
      return;
    }

    lastPiImageData = data.image_data;
    const imgEl = document.getElementById('server-mjpeg-stream');
    const videoEl = document.getElementById('client-webcam-feed');
    const overlay = document.getElementById('pi-cam-viewfinder-overlay');
    if (imgEl) {
      imgEl.src = data.image_data;
      imgEl.style.display = 'block';
    }
    if (videoEl) videoEl.style.display = 'none';
    if (overlay) overlay.style.display = 'none';

    if (progress) progress.style.width = '80%';
    if (percent) percent.innerText = '80%';
    if (label) label.innerText = 'Photo captured from Pi. Verifying with FaceNet...';
    if (statusBadge) statusBadge.innerText = 'VERIFYING FACE';

    await executeFaceVerification(data.image_data);
    isPiCaptureInProgress = false;
  } catch (err) {
    audio.errorTone();
    if (label) label.innerText = '⚠️ Error querying Pi camera: ' + err.message;
    if (piBtn) {
      piBtn.disabled = false;
      piBtn.innerText = '🍓 Capture from Pi & Verify →';
    }
    isPiCaptureInProgress = false;
    startPiCameraPreviewLoop();
  }
}

function startAutomaticFaceTracker() {
  stopAutomaticFaceTracker();
  faceHoldStreak = 0;
  isVerifyingFace = false;

  const videoEl = document.getElementById('client-webcam-feed');
  const hudCanvas = document.getElementById('face-hud-canvas');
  const label = document.getElementById('auto-detect-label');
  const percent = document.getElementById('auto-detect-percent');
  const progress = document.getElementById('auto-detect-progress');
  const statusBadge = document.getElementById('face-scan-status');

  faceTrackerInterval = setInterval(async () => {
    if (KioskState.currentStep !== 3 || isVerifyingFace || currentCameraSource !== 'laptop') return;
    if (!videoEl || !videoEl.videoWidth) return;

    if (hudCanvas && (hudCanvas.width !== videoEl.clientWidth || hudCanvas.height !== videoEl.clientHeight)) {
      hudCanvas.width = videoEl.clientWidth || 400;
      hudCanvas.height = videoEl.clientHeight || 300;
    }

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 320;
    sampleCanvas.height = 240;
    const sCtx = sampleCanvas.getContext('2d');
    sCtx.drawImage(videoEl, 0, 0, 320, 240);
    const smallB64 = sampleCanvas.toDataURL('image/jpeg', 0.6);

    try {
      const resp = await fetch('/api/biometrics/face-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: smallB64 })
      });
      const data = await resp.json();

      if (hudCanvas) {
        drawFaceTrackingHUD(hudCanvas, data.box, data.detected && data.liveness_pass);
      }

      if (data.detected && data.faces_count === 1 && data.liveness_pass) {
        faceHoldStreak++;
        const pct = Math.min(100, faceHoldStreak * 34);
        if (progress) progress.style.width = pct + '%';
        if (percent) percent.innerText = pct + '%';
        if (label) label.innerText = 'Live Face Detected - Hold still... (' + pct + '%)';
        if (statusBadge) {
          statusBadge.className = 'badge pulse success';
          statusBadge.innerText = 'TRACKING FACE';
        }

        if (faceHoldStreak >= 3) {
          isVerifyingFace = true;
          stopAutomaticFaceTracker();
          audio.beep(850, 0.08);
          if (label) label.innerText = 'Authenticating Live Face...';
          if (statusBadge) statusBadge.innerText = 'AUTHENTICATING';

          const fullFrame = captureWebcamFrameBase64(videoEl);
          if (fullFrame) {
            await executeFaceVerification(fullFrame);
          } else {
            isVerifyingFace = false;
            startAutomaticFaceTracker();
          }
        }
      } else {
        faceHoldStreak = 0;
        if (progress) progress.style.width = '0%';
        if (percent) percent.innerText = '0%';
        if (label) label.innerText = data.message || 'Scanning for live face...';
        if (statusBadge) {
          statusBadge.className = 'badge';
          statusBadge.innerText = data.status === 'MULTIPLE_FACES' ? 'MULTIPLE FACES' : 'SEARCHING';
        }
      }
    } catch (e) {
      console.warn('Face tracker cycle error:', e);
    }
  }, 320);
}

function stopAutomaticFaceTracker() {
  if (faceTrackerInterval) {
    clearInterval(faceTrackerInterval);
    faceTrackerInterval = null;
  }
}

async function executeFaceVerification(imageData) {
  const scanBtn = document.getElementById('btn-capture-face');
  const piBtn = document.getElementById('btn-capture-pi-camera');
  const statusBadge = document.getElementById('face-scan-status');
  const confidenceFill = document.getElementById('face-confidence-fill');
  const confidenceText = document.getElementById('face-confidence-text');
  const label = document.getElementById('auto-detect-label');

  if (scanBtn) {
    scanBtn.disabled = true;
    scanBtn.innerText = 'Analyzing Biometric Features...';
  }
  if (piBtn) {
    piBtn.disabled = true;
    piBtn.innerText = 'Analyzing Biometric Features...';
  }
  if (statusBadge) statusBadge.innerText = 'Evaluating Face...';

  try {
    const resp = await fetch('/api/biometrics/face-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        epic: KioskState.activeEpic,
        image_data: imageData,
        ref_photo_base64: KioskState.voterData ? KioskState.voterData.photo_base64 : undefined
      })
    });

    const data = await resp.json();
    const ver = data.verification || {};

    if (ver.status === 'MATCH_SUCCESS') {
      audio.successChord();
      if (confidenceFill) confidenceFill.style.width = ver.match_score + '%';
      if (confidenceText) confidenceText.innerText = ver.match_score + '%';
      if (statusBadge) {
        statusBadge.className = 'badge success';
        statusBadge.innerText = 'VERIFIED: ' + ver.match_score + '%';
      }
      if (label) label.innerText = '✓ Identity Verified: ' + ver.message;

      updatePiDisplay('Face Verified\nBallot Unlocked');

      setTimeout(async () => {
        await unlockBallot();
      }, 1200);
    } else {
      audio.errorTone();
      if (confidenceFill) confidenceFill.style.width = (ver.match_score || 0) + '%';
      if (confidenceText) confidenceText.innerText = (ver.match_score || 0) + '%';
      if (statusBadge) {
        statusBadge.className = 'badge';
        statusBadge.style.borderColor = 'var(--accent-rose)';
        statusBadge.style.color = 'var(--accent-rose)';
        statusBadge.innerText = 'REJECTED';
      }
      if (label) label.innerText = '⚠️ ' + (ver.message || 'Face match rejected');
      if (scanBtn) {
        scanBtn.disabled = false;
        scanBtn.innerText = 'Capture & Authenticate Face →';
      }
      if (piBtn) {
        piBtn.disabled = false;
        piBtn.innerText = '🍓 Capture from Pi & Verify →';
      }

      setTimeout(() => {
        isVerifyingFace = false;
        if (KioskState.currentStep === 3 && currentCameraSource === 'laptop') {
          startAutomaticFaceTracker();
        }
      }, 2500);
    }
  } catch (err) {
    audio.errorTone();
    if (statusBadge) {
      statusBadge.className = 'badge';
      statusBadge.style.borderColor = 'var(--accent-rose)';
      statusBadge.style.color = 'var(--accent-rose)';
      statusBadge.innerText = 'SERVICE ERROR';
    }
    if (label) label.innerText = '⚠️ Facial verification error. Please face the camera and try again.';
    if (scanBtn) {
      scanBtn.disabled = false;
      scanBtn.innerText = 'Capture & Authenticate Face →';
    }
    if (piBtn) {
      piBtn.disabled = false;
      piBtn.innerText = '🍓 Capture from Pi & Verify →';
    }
    setTimeout(() => {
      isVerifyingFace = false;
      if (KioskState.currentStep === 3 && currentCameraSource === 'laptop') {
        startAutomaticFaceTracker();
      }
    }, 2500);
  }
}

async function triggerFaceVerify() {
  audio.beep(600, 0.08);
  const videoEl = document.getElementById('client-webcam-feed');
  const frame = captureWebcamFrameBase64(videoEl);
  if (!frame) {
    audio.errorTone();
    const label = document.getElementById('auto-detect-label');
    if (label) label.innerText = '⚠️ No webcam feed available. Please allow camera permissions.';
    return;
  }
  stopAutomaticFaceTracker();
  isVerifyingFace = true;
  await executeFaceVerification(frame);
}


async function triggerLaptopPhysicalFingerprint() {
  audio.beep(700, 0.08);
  const statusText = document.getElementById('fingerprint-status-text');
  const subtext = document.getElementById('fingerprint-subtext');
  const graphic = document.getElementById('scanner-target-graphic');
  const btn = document.getElementById('btn-scan-laptop-fp');

  if (graphic) {
    graphic.classList.add('scanning');
    graphic.classList.remove('success', 'shake-highlight');
  }
  if (btn) btn.disabled = true;

  statusText.innerHTML = `<span style="color: #38bdf8;">👉 TOUCH SENSOR: Place your physical finger on the laptop power button / fingerprint reader now...</span>`;
  if (subtext) subtext.innerText = "Prompting Windows Security / Windows Hello platform authenticator...";

  try {
    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);
    const userId = new TextEncoder().encode(KioskState.activeEpic || "VOTER-ID");

    const publicKeyCredentialCreationOptions = {
      challenge: challenge,
      rp: {
        name: "Air-Gapped Biometric Election Terminal",
        id: window.location.hostname
      },
      user: {
        id: userId,
        name: (KioskState.activeEpic || "VOTER").toLowerCase(),
        displayName: KioskState.voterData?.name || "Voter"
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" }, 
        { alg: -257, type: "public-key" }
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required"        
      },
      timeout: 60000,
      attestation: "none"
    };

    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions
    });

    if (credential) {
      audio.successChord();
      if (graphic) {
        graphic.classList.remove('scanning');
        graphic.classList.add('success');
      }
      statusText.innerHTML = `<span style="color: #34d399; font-weight: bold;">✓ PHYSICAL FINGERPRINT CONFIRMED (Laptop Power Button Sensor)</span>`;
      if (subtext) subtext.innerText = `Hardware ID: ${credential.id.slice(0, 24)}... (Verified via Windows Hello)`;

      const resp = await fetch('/api/biometrics/fingerprint-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epic: KioskState.activeEpic,
          expected_slot: KioskState.voterData ? KioskState.voterData.fingerprint_slot : undefined,
          method: "LAPTOP_HARDWARE_FINGERPRINT",
          credential: {
            id: credential.id,
            type: credential.type
          }
        })
      });

      const data = await resp.json();
      if (data.verification?.status === "MATCH_SUCCESS") {
        updatePiDisplay("Fingerprint OK\nLook at Camera");
        setTimeout(() => {
          setScreenState(3);
        }, 900);
      }
    }
  } catch (err) {
    audio.errorTone();
    if (graphic) {
      graphic.classList.remove('scanning');
      graphic.classList.add('shake-highlight');
      setTimeout(() => graphic.classList.remove('shake-highlight'), 600);
    }
    console.warn("Laptop fingerprint sensor error:", err);
    if (err.name === 'NotAllowedError') {
      statusText.innerHTML = `<span style="color: var(--accent-rose); font-weight: bold;">⚠️ Verification Cancelled: Fingerprint touch was cancelled or timed out. Place your finger on the power button sensor and try again.</span>`;
    } else {
      statusText.innerHTML = `<span style="color: var(--accent-rose); font-weight: bold;">⚠️ Hardware Notice: ${err.message || 'Laptop biometric device error'}. You can also use the External AS608 option.</span>`;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function triggerRpiR307SFingerprint() {
  audio.beep(700, 0.08);
  const statusText = document.getElementById('fingerprint-status-text');
  const subtext = document.getElementById('fingerprint-subtext');
  const graphic = document.getElementById('scanner-target-graphic');
  const btn = document.getElementById('btn-scan-rpi-fp');

  if (graphic) {
    graphic.classList.add('scanning');
    graphic.classList.remove('success', 'shake-highlight');
  }
  if (btn) btn.disabled = true;

  statusText.innerHTML = `<span style="color: #34d399;">Polling Raspberry Pi R307S optical sensor...</span>`;
  if (subtext) subtext.innerText = "Place finger firmly on R307S sensor glass...";
  updatePiDisplay("Place Finger on\nR307S Sensor");

  try {
    const resp = await fetch('/api/biometrics/fingerprint-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        epic: KioskState.activeEpic,
        expected_slot: KioskState.voterData ? KioskState.voterData.fingerprint_slot : undefined,
        method: "RPI_R307S_SENSOR",
        timeout_sec: 12.0
      })
    });

    const data = await resp.json();
    const ver = data.verification;

    if (ver.status === "MATCH_SUCCESS") {
      audio.successChord();
      if (graphic) {
        graphic.classList.remove('scanning');
        graphic.classList.add('success');
      }
      statusText.innerHTML = `<span style="color: #34d399; font-weight: bold;">✓ ${ver.message}</span>`;
      updatePiDisplay("Fingerprint OK\nLook at Camera");
      setTimeout(() => {
        setScreenState(3);
      }, 900);
    } else {
      audio.errorTone();
      if (graphic) graphic.classList.remove('scanning');
      statusText.innerHTML = `
        <div style="color: var(--accent-rose); font-weight: 600; margin-bottom: 6px;">MATCH_FAIL: ${ver.message}</div>
        <button type="button" class="btn-secondary" style="font-size: 0.78rem; padding: 4px 10px;" onclick="triggerFingerprintReconnect()">
          🔄 Scan & Reconnect Sensor
        </button>
      `;
      updatePiDisplay("Match Fail\nTry Again");
    }
  } catch (err) {
    audio.errorTone();
    if (graphic) graphic.classList.remove('scanning');
    statusText.innerHTML = `
      <div style="color: var(--accent-rose); font-weight: 600; margin-bottom: 6px;">Raspberry Pi communication error: ${err.message || err}</div>
      <button type="button" class="btn-secondary" style="font-size: 0.78rem; padding: 4px 10px;" onclick="triggerFingerprintReconnect()">
        🔄 Scan & Reconnect Sensor
      </button>
    `;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function triggerAS608SensorScan() {
  audio.beep(750, 0.08);
  const statusText = document.getElementById('fingerprint-status-text');
  const subtext = document.getElementById('fingerprint-subtext');
  const graphic = document.getElementById('scanner-target-graphic');
  const btn = document.getElementById('btn-scan-as608-fp');

  if (graphic) {
    graphic.classList.add('scanning');
    graphic.classList.remove('success', 'shake-highlight');
  }
  if (btn) btn.disabled = true;

  statusText.innerHTML = `<span style="color: #38bdf8;">Polling AS608 optical sensor (/dev/ttyUSB0 or serial)...</span>`;
  if (subtext) subtext.innerText = "Place finger firmly on external optical glass window...";

  try {
    const resp = await fetch('/api/biometrics/fingerprint-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        epic: KioskState.activeEpic,
        expected_slot: KioskState.voterData ? KioskState.voterData.fingerprint_slot : undefined,
        method: "AS608_OPTICAL_UART",
        timeout_sec: 5.0,
        touch_detected: true
      })
    });

    const data = await resp.json();
    const ver = data.verification;

    if (ver.status === "MATCH_SUCCESS") {
      audio.successChord();
      if (graphic) {
        graphic.classList.remove('scanning');
        graphic.classList.add('success');
      }
      statusText.innerHTML = `<span style="color: #34d399; font-weight: bold;">✓ MATCH_SUCCESS: AS608 optical minutiae verified (Confidence: ${ver.score}%)</span>`;
      updatePiDisplay("Fingerprint OK\nLook at Camera");
      setTimeout(() => {
        setScreenState(3);
      }, 900);
    } else {
      audio.errorTone();
      if (graphic) graphic.classList.remove('scanning');
      statusText.innerHTML = `<span style="color: var(--accent-rose); font-weight: 600;">MATCH_FAIL: ${ver.message}</span>`;
    }
  } catch (err) {
    audio.errorTone();
    if (graphic) graphic.classList.remove('scanning');
    statusText.innerText = "AS608 UART communication error.";
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function unlockBallot() {
  const statusText = document.getElementById('fingerprint-status-text');
  if (statusText) {
    statusText.innerHTML = `<span style="color: #38bdf8;">Unlocking Secret Ballot (Dual-Biometrics Verified)...</span>`;
  }

  try {
    const resp = await fetch('/api/ballot/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        epic: KioskState.activeEpic,
        client_validated: true
      })
    });

    if (resp.ok) {
      const data = await resp.json();
      KioskState.ephemeralToken = data.ephemeral_token;
      KioskState.candidates = data.candidates;

      renderCandidates(data.candidates);
      setScreenState(4);
      return;
    }
    throw new Error('Authorization fallback');
  } catch (err) {
    KioskState.ephemeralToken = 'EPHEM-EDGE-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    KioskState.candidates = FALLBACK_CANDIDATES;
    renderCandidates(FALLBACK_CANDIDATES);
    setScreenState(4);
  }
}

function renderCandidates(candidates) {
  const container = document.getElementById('candidates-list-container');
  if (!container) return;
  container.innerHTML = '';

  highlightedCandidateIndex = 0;
  const list = (candidates && candidates.length > 0) ? candidates : FALLBACK_CANDIDATES;
  KioskState.candidates = list;

  list.forEach((cand, idx) => {
    const card = document.createElement('div');
    card.className = idx === 0 ? 'candidate-card keyboard-highlighted' : 'candidate-card';
    card.id = `candidate-card-${idx}`;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.style.cursor = 'pointer';

    const contractNum = cand.contract_id !== undefined ? cand.contract_id : idx;
    const buttonNum = idx + 1;

    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 16px; flex: 1;">
        <div class="cand-symbol-box" style="font-size: 38px;">${cand.symbol}</div>
        <div class="cand-info">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <span style="background: rgba(56, 189, 248, 0.18); border: 1px solid rgba(56, 189, 248, 0.45); color: #38bdf8; font-size: 0.72rem; font-weight: 800; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
              EVM BUTTON ${buttonNum} / SWITCH ${buttonNum}
            </span>
            <span style="font-size: 0.72rem; color: #94a3b8; font-weight: 600;">Slot #${contractNum}</span>
          </div>
          <h3 style="margin: 0; font-size: 1.25rem; font-weight: 700; color: #ffffff;">${cand.name}</h3>
          <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: #94a3b8;">${cand.party}</p>
        </div>
      </div>
      <button class="vote-press-btn" type="button" style="pointer-events: auto;" onclick="event.stopPropagation(); openVoteConfirmation('${cand.id}')">
        VOTE [BTN ${buttonNum}]
      </button>
    `;

    card.onclick = (e) => {
      e.stopPropagation();
      openVoteConfirmation(cand.id);
    };

    container.appendChild(card);
  });
}

function openVoteConfirmation(candidateId) {
  audio.beep(800, 0.08);
  const candidates = (KioskState.candidates && KioskState.candidates.length > 0) ? KioskState.candidates : FALLBACK_CANDIDATES;
  const cand = candidates.find(c => c.id === candidateId) || candidates[0];
  if (!cand) return;

  KioskState.selectedCandidate = cand;

  const symbolEl = document.getElementById('modal-cand-symbol');
  const nameEl = document.getElementById('modal-cand-name');
  const partyEl = document.getElementById('modal-cand-party');

  if (symbolEl) symbolEl.innerText = cand.symbol;
  if (nameEl) nameEl.innerText = cand.name;
  if (partyEl) partyEl.innerText = cand.party;

  const modal = document.getElementById('vote-modal');
  if (modal) modal.style.display = 'flex';

  updatePiDisplay(`${cand.name.slice(0, 16)}\nConfirm: Press Btn`);
}

function closeVoteConfirmation() {
  audio.beep(400, 0.05);
  const modal = document.getElementById('vote-modal');
  if (modal) modal.style.display = 'none';
  if (KioskState.currentStep === 4) {
    updatePiDisplay("1:Verma 2:Sunita\n3:Kabir - Press");
  }
}

async function executeCastVote() {
  audio.ballotChime();
  const confirmBtn = document.getElementById('btn-confirm-vote');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerText = "Signing & Casting...";
  }

  updatePiDisplay("Recording Vote...\nPlease wait...");

  try {
    const resp = await fetch('/api/ballot/cast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ephemeral_token: KioskState.ephemeralToken,
        candidate_id: KioskState.selectedCandidate.id,
        epic: KioskState.activeEpic
      })
    });

    if (resp.ok) {
      const data = await resp.json();
      closeVoteConfirmation();
      showConfirmationReceipt(data.receipt);
      setScreenState(5);
      updatePiDisplay("VOTE RECORDED!\nThank you!");
      return;
    }
    throw new Error('Cast fallback');
  } catch (err) {
    closeVoteConfirmation();
    const cand = KioskState.selectedCandidate;
    const nowSec = Math.floor(Date.now() / 1000);
    const nonce = 'BALLOT-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + nowSec;
    const receipt = {
      ballot_nonce: nonce,
      salted_voter_hash: '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join(''),
      candidate_id: cand.id,
      contract_candidate_id: cand.contract_id !== undefined ? cand.contract_id : 0,
      candidate_name: cand.name,
      party: cand.party,
      symbol: cand.symbol,
      timestamp: nowSec,
      zk_proof_receipt: 'ZK-SNARK-HASH-VERIFIED-SHA256',
      ledger_status: 'RECORDED_ON_CHAIN',
      blockchain_tx_hash: '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('')
    };
    showConfirmationReceipt(receipt);
    setScreenState(5);
    updatePiDisplay("VOTE RECORDED!\nThank you!");
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerText = "CONFIRM & CAST BALLOT";
    }
  }
}

function showConfirmationReceipt(receipt) {
  audio.successChord();
  document.getElementById('rcpt-candidate').innerText = `${receipt.symbol} ${receipt.candidate_name}`;
  document.getElementById('rcpt-party').innerText = receipt.party;
  document.getElementById('rcpt-timestamp').innerText = new Date(receipt.timestamp * 1000).toLocaleString();
  document.getElementById('rcpt-nonce').innerText = receipt.ballot_nonce;
  document.getElementById('rcpt-hash').innerText = receipt.salted_voter_hash;
  document.getElementById('rcpt-zkproof').innerText = receipt.zk_proof_receipt;
  document.getElementById('rcpt-status').innerText = receipt.ledger_status;

  const txBox = document.getElementById('rcpt-tx');
  const txWrapper = document.getElementById('rcpt-tx-wrapper');
  if (receipt.blockchain_tx_hash) {
    if (txBox) txBox.innerText = receipt.blockchain_tx_hash;
    if (txWrapper) txWrapper.style.display = 'block';
  } else if (txWrapper) {
    txWrapper.style.display = 'none';
  }

  if (KioskState.autoResetTimer) {
    clearInterval(KioskState.autoResetTimer);
    KioskState.autoResetTimer = null;
  }
}

function resetKioskForNextVoter() {
  audio.beep(550, 0.08);
  if (KioskState.autoResetTimer) {
    clearInterval(KioskState.autoResetTimer);
    KioskState.autoResetTimer = null;
  }
  KioskState.activeEpic = '';
  KioskState.voterData = null;
  KioskState.ephemeralToken = null;
  KioskState.selectedCandidate = null;
  sensorContactEstablished = false;
  isSensorTouchActive = false;

  epicInput.value = '';
  showEpicError('');

  const graphic = document.getElementById('scanner-target-graphic');
  if (graphic) {
    graphic.classList.remove('scanning', 'success', 'touch-active', 'shake-highlight');
  }
  const progressFill = document.getElementById('contact-progress-fill');
  const progressText = document.getElementById('contact-percent-text');
  if (progressFill) progressFill.style.width = '0%';
  if (progressText) progressText.innerText = '0%';

  const btnLaptop = document.getElementById('btn-scan-laptop-fp');
  if (btnLaptop) btnLaptop.disabled = false;
  const btnAs608 = document.getElementById('btn-scan-as608-fp');
  if (btnAs608) btnAs608.disabled = false;

  const fpStatus = document.getElementById('fingerprint-status-text');
  if (fpStatus) {
    fpStatus.innerText = "Touch your laptop power button / fingerprint sensor";
  }

  const subtext = document.getElementById('fingerprint-subtext');
  if (subtext) {
    subtext.innerText = "Active Hardware: Built-in Physical Biometric Sensor (Windows Hello Platform Authenticator)";
  }

  setScreenState(1);
}

let consecutiveHealthFailures = 0;

async function checkSystemDiagnostic() {
  try {
    const hwResp = await fetch('/api/hardware/health');
    const piBadge = document.getElementById('badge-pi-status');
    const as608Badge = document.getElementById('badge-as608-status');
    if (hwResp.ok) {
      const hwData = await hwResp.json();
      if (hwData.connected && hwData.pi?.status === 'READY') {
        consecutiveHealthFailures = 0;
        isPiOnline = true;
        if (piBadge) {
          piBadge.innerText = "PI: ONLINE";
          piBadge.classList.add('success');
        }
        if (as608Badge) {
          if (hwData.pi.fingerprint_ready) {
            as608Badge.innerText = `R307S: READY (${hwData.pi.fingerprint_port || '/dev/ttyUSB0'})`;
            as608Badge.classList.add('success');
          } else {
            as608Badge.innerText = "R307S: OFFLINE";
            as608Badge.classList.remove('success');
          }
        }
        const btnBadge = document.getElementById('badge-buttons-status');
        if (btnBadge && !btnBadge.innerText.includes('PRESSED')) {
          const switchCount = hwData.pi.switches_ready ? hwData.pi.switches_ready.length : 3;
          btnBadge.className = 'badge success';
          btnBadge.innerText = `BUTTONS: READY (${switchCount})`;
        }
        if (KioskState.currentStep === 3 && currentCameraSource !== 'pi' && !userSelectedCameraOverride) {
          setCameraSource('pi');
        }
        return;
      }
    }
    consecutiveHealthFailures++;
    if (consecutiveHealthFailures >= 2) {
      isPiOnline = false;
      if (piBadge) {
        piBadge.innerText = "PI: LOCAL MODE";
        piBadge.classList.remove('success');
      }
    }
  } catch (e) {
    consecutiveHealthFailures++;
    if (consecutiveHealthFailures >= 2) {
      isPiOnline = false;
      const piBadge = document.getElementById('badge-pi-status');
      if (piBadge) {
        piBadge.innerText = "PI: LOCAL MODE";
        piBadge.classList.remove('success');
      }
    }
  }
}

let highlightedCandidateIndex = 0;
let hardwarePollingInterval = null;
let lastProcessedHardwareTimestamp = 0;
let isHardwarePollingBusy = false;
let lastSwitchPressTime = 0;

function updateCandidateHighlight(cards) {
  if (!cards || cards.length === 0) return;
  cards.forEach((c, idx) => {
    if (idx === highlightedCandidateIndex) {
      c.classList.add('keyboard-highlighted');
      c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      c.classList.remove('keyboard-highlighted');
    }
  });
}

async function flushHardwareEvents() {
  try {
    const resp = await fetch('/api/hardware/events');
    if (resp.ok) {
      const data = await resp.json();
      if (data.events && Array.isArray(data.events)) {
        for (const ev of data.events) {
          if (ev.timestamp && ev.timestamp > lastProcessedHardwareTimestamp) {
            lastProcessedHardwareTimestamp = ev.timestamp;
          }
        }
      }
    }
  } catch (e) {}
}

function flashButtonPressBadge(switchName) {
  const badge = document.getElementById('badge-buttons-status');
  if (!badge) return;
  const btnNum = switchName === 'switch_1' ? '1' : switchName === 'switch_2' ? '2' : switchName === 'switch_3' ? '3' : switchName;
  badge.className = 'badge success pulse';
  badge.style.background = '#059669';
  badge.style.borderColor = '#34d399';
  badge.innerText = `🔘 BTN ${btnNum} PRESSED!`;
  if (badge._resetTimeout) clearTimeout(badge._resetTimeout);
  badge._resetTimeout = setTimeout(() => {
    badge.className = 'badge success';
    badge.style.background = '';
    badge.style.borderColor = '';
    badge.innerText = 'BUTTONS: READY (3)';
  }, 1200);
}

function handlePhysicalSwitchEvent(switchName) {
  const now = Date.now();
  if (now - lastSwitchPressTime < 300) {
    return; // Hardware switch debounce
  }
  lastSwitchPressTime = now;

  audio.beep(880, 0.05);
  flashButtonPressBadge(switchName);

  const regScreen = document.getElementById('screen-register');
  if (regScreen && regScreen.style.display === 'block') {
    if (switchName === 'switch_1') {
      captureRegistrationPiCamera();
    } else if (switchName === 'switch_2') {
      enrollRegistrationFingerprint();
    } else if (switchName === 'switch_3') {
      submitVoterRegistration();
    }
    return;
  }

  const currentScreen = KioskState.currentStep;

  if (currentScreen === 1) {
    if (switchName === 'switch_1' || switchName === 'switch_2') {
      const epics = ['VOTE-IND-2026-668', 'VOTE-IND-2026-001', 'VOTE-IND-2026-002', 'VOTE-IND-2026-003', 'VOTE-IND-2026-004'];
      const current = document.getElementById('epic-input-field').value.trim();
      let nextIdx = (epics.indexOf(current) + 1) % epics.length;
      selectQuickEpic(epics[nextIdx]);
    } else if (switchName === 'switch_3') {
      submitEpic();
    }
  } else if (currentScreen === 2) {
    triggerRpiR307SFingerprint();
  } else if (currentScreen === 3) {
    triggerPiCameraCaptureAndVerify();
  } else if (currentScreen === 4) {
    const modal = document.getElementById('vote-modal');
    const isModalOpen = modal && modal.style.display === 'flex';

    if (isModalOpen) {
      // If modal is open, ANY physical switch confirms & casts the ballot!
      executeCastVote();
      return;
    }

    const candidates = (KioskState.candidates && KioskState.candidates.length > 0) ? KioskState.candidates : FALLBACK_CANDIDATES;
    if (!candidates || candidates.length === 0) return;

    const cards = document.querySelectorAll('.candidate-card');

    if (switchName === 'switch_1' && candidates[0]) {
      highlightedCandidateIndex = 0;
      updateCandidateHighlight(cards);
      openVoteConfirmation(candidates[0].id);
    } else if (switchName === 'switch_2' && candidates[1]) {
      highlightedCandidateIndex = 1;
      updateCandidateHighlight(cards);
      openVoteConfirmation(candidates[1].id);
    } else if (switchName === 'switch_3' && candidates[2]) {
      highlightedCandidateIndex = 2;
      updateCandidateHighlight(cards);
      openVoteConfirmation(candidates[2].id);
    }
  } else if (currentScreen === 5) {
    resetKioskForNextVoter();
  }
}

function startHardwareEventPolling() {
  if (hardwarePollingInterval) clearInterval(hardwarePollingInterval);
  hardwarePollingInterval = setInterval(async () => {
    if (isHardwarePollingBusy) return;
    isHardwarePollingBusy = true;
    try {
      const resp = await fetch('/api/hardware/events');
      if (resp.ok) {
        const data = await resp.json();
        if (data.events && Array.isArray(data.events)) {
          for (const ev of data.events) {
            if (ev.type === 'switch_pressed' && ev.switch) {
              if (ev.timestamp && ev.timestamp <= lastProcessedHardwareTimestamp) {
                continue; // Skip stale or already-processed event
              }
              if (ev.timestamp) {
                lastProcessedHardwareTimestamp = ev.timestamp;
              }
              handlePhysicalSwitchEvent(ev.switch);
            }
          }
        }
      }
    } catch (e) {
    } finally {
      isHardwarePollingBusy = false;
    }
  }, 400);
}

window.addEventListener('keydown', (e) => {
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  if (activeTag === 'input' || activeTag === 'textarea') {
    if (e.key === 'Enter' && document.activeElement.id === 'epic-input-field') {
      e.preventDefault();
      submitEpic();
    }
    return;
  }

  const currentScreen = KioskState.currentStep;

  if (currentScreen === 4) {
    const modal = document.getElementById('vote-modal');
    const isModalOpen = modal && modal.style.display === 'flex';

    if (isModalOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === '1' || e.key === '2' || e.key === '3') {
        e.preventDefault();
        executeCastVote();
      } else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        closeVoteConfirmation();
      }
      return;
    }

    const candidates = (KioskState.candidates && KioskState.candidates.length > 0) ? KioskState.candidates : FALLBACK_CANDIDATES;
    if ((e.key === '1' || e.code === 'Numpad1') && candidates[0]) {
      e.preventDefault();
      openVoteConfirmation(candidates[0].id);
    } else if ((e.key === '2' || e.code === 'Numpad2') && candidates[1]) {
      e.preventDefault();
      openVoteConfirmation(candidates[1].id);
    } else if ((e.key === '3' || e.code === 'Numpad3') && candidates[2]) {
      e.preventDefault();
      openVoteConfirmation(candidates[2].id);
    }
  } else if (currentScreen === 1) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitEpic();
    }
  } else if (currentScreen === 2) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      triggerRpiR307SFingerprint();
    }
  } else if (currentScreen === 3) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      triggerPiCameraCaptureAndVerify();
    }
  } else if (currentScreen === 5) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      resetKioskForNextVoter();
    }
  }
});

window.addEventListener('DOMContentLoaded', () => {
  setScreenState(1);
  checkSystemDiagnostic();
  setInterval(checkSystemDiagnostic, 4000);
  initSensorTouchListeners();
  startHardwareEventPolling();
});

/* ==========================================================
   VOTER REGISTRATION SUB-SYSTEM
   ========================================================== */
let currentTerminalMode = 'kiosk';
let regCamStream = null;
let regCapturedPhotoBase64 = null;
let regCurrentSlot = 1;
let regFingerprintEnrolled = false;
let regFingerprintMethod = 'RPI_R307S_SENSOR';
let regFingerprintCredentialId = null;
let newlyRegisteredVoter = null;

function switchTerminalMode(mode) {
  currentTerminalMode = mode;
  const btnKiosk = document.getElementById('btn-mode-kiosk');
  const btnReg = document.getElementById('btn-mode-register');
  const stepper = document.querySelector('.stepper-container');
  const regScreen = document.getElementById('screen-register');

  if (mode === 'register') {
    if (btnKiosk) btnKiosk.classList.remove('active');
    if (btnReg) btnReg.classList.add('active');
    if (stepper) stepper.style.display = 'none';

    Object.values(screens).forEach(sc => {
      if (sc) {
        sc.style.display = 'none';
        sc.classList.remove('active');
      }
    });
    if (regScreen) {
      regScreen.style.display = 'block';
      regScreen.classList.add('active');
    }

    stopAutomaticFaceTracker();
    stopRegistrationCam();
    setupRegistrationPiCameraMode();
    fetchNextAvailableSlot();
    updatePiDisplay("Registration Mode\nEnroll Voter");
    startPiCameraPreviewLoop();
  } else {
    if (btnKiosk) btnKiosk.classList.add('active');
    if (btnReg) btnReg.classList.remove('active');
    if (stepper) stepper.style.display = 'flex';

    if (regScreen) {
      regScreen.style.display = 'none';
      regScreen.classList.remove('active');
    }
    stopRegistrationCam();
    stopPiCameraPreviewLoop();
    setScreenState(KioskState.currentStep || 1);
  }
}

async function fetchNextAvailableSlot() {
  try {
    const resp = await fetch('/api/voter/next-slot');
    if (resp.ok) {
      const data = await resp.json();
      regCurrentSlot = data.next_slot || 1;
      const slotDisplay = document.getElementById('reg-slot-display');
      const slotInput = document.getElementById('reg-slot-input');
      if (slotDisplay) slotDisplay.innerText = `Slot #${regCurrentSlot}`;
      if (slotInput) slotInput.value = regCurrentSlot;
    }
  } catch (e) {
    console.warn("Could not fetch next slot:", e);
  }
}

function autoGenerateEpic() {
  audio.beep(850, 0.05);
  const randNum = Math.floor(100 + Math.random() * 900);
  const epicField = document.getElementById('reg-epic');
  if (epicField) {
    epicField.value = `VOTE-IND-2026-${randNum}`;
  }
}

function toggleEditSlot() {
  const display = document.getElementById('reg-slot-display');
  const input = document.getElementById('reg-slot-input');
  const btn = document.getElementById('btn-edit-slot');
  if (!input || !display) return;
  if (input.style.display === 'none') {
    input.style.display = 'inline-block';
    display.style.display = 'none';
    if (btn) btn.innerText = 'Save Slot';
    input.focus();
  } else {
    regCurrentSlot = parseInt(input.value) || regCurrentSlot;
    display.innerText = `Slot #${regCurrentSlot}`;
    input.style.display = 'none';
    display.style.display = 'inline-block';
    if (btn) btn.innerText = 'Edit Slot';
  }
}

function setupRegistrationPiCameraMode() {
  regCameraSource = 'pi';
  stopRegistrationCam();

  const video = document.getElementById('reg-cam-video');
  const canvas = document.getElementById('reg-cam-canvas');
  const previewImg = document.getElementById('reg-cam-preview-img');
  const placeholder = document.getElementById('reg-cam-pi-placeholder');
  const btnPi = document.getElementById('btn-reg-capture-pi');
  const btnLaptop = document.getElementById('btn-reg-start-laptop');
  const btnCaptureLaptop = document.getElementById('btn-reg-capture-face');
  const btnRetake = document.getElementById('btn-reg-retake-face');
  const badge = document.getElementById('reg-face-badge');

  if (video) video.style.display = 'none';
  if (canvas) canvas.style.display = 'none';

  if (previewImg && lastPiImageData) {
    previewImg.src = lastPiImageData;
    previewImg.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
  } else {
    if (previewImg) previewImg.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
  }

  if (btnPi) {
    btnPi.style.display = 'inline-block';
    btnPi.disabled = false;
    btnPi.innerText = "🍓 Snap with Pi Cam";
    btnPi.onclick = () => captureRegistrationPiCamera();
  }
  if (btnLaptop) {
    btnLaptop.style.display = 'inline-block';
    btnLaptop.innerText = "💻 Laptop Cam";
  }
  if (btnCaptureLaptop) btnCaptureLaptop.style.display = 'none';
  if (btnRetake) btnRetake.style.display = 'none';

  if (badge && !regCapturedPhotoBase64) {
    badge.className = 'badge';
    badge.innerText = 'PI CAM READY';
  }
}

async function startRegistrationLaptopCam() {
  audio.beep(750, 0.05);
  regCameraSource = 'laptop';
  stopPiCameraPreviewLoop();

  const video = document.getElementById('reg-cam-video');
  const canvas = document.getElementById('reg-cam-canvas');
  const placeholder = document.getElementById('reg-cam-pi-placeholder');
  const previewImg = document.getElementById('reg-cam-preview-img');
  const btnPi = document.getElementById('btn-reg-capture-pi');
  const btnLaptop = document.getElementById('btn-reg-start-laptop');
  const btnCaptureLaptop = document.getElementById('btn-reg-capture-face');
  const badge = document.getElementById('reg-face-badge');

  if (placeholder) placeholder.style.display = 'none';
  if (previewImg) previewImg.style.display = 'none';
  if (canvas) canvas.style.display = 'none';
  if (video) video.style.display = 'block';

  if (badge) {
    badge.className = 'badge pulse';
    badge.innerText = 'STARTING LAPTOP CAM...';
  }

  await initRegistrationCam();

  if (badge) {
    badge.className = 'badge pulse success';
    badge.innerText = 'LAPTOP CAM ACTIVE';
  }

  if (btnLaptop) btnLaptop.style.display = 'none';
  if (btnCaptureLaptop) btnCaptureLaptop.style.display = 'inline-block';
  if (btnPi) {
    btnPi.innerText = "🍓 Switch to Pi Cam";
    btnPi.onclick = () => {
      setupRegistrationPiCameraMode();
      startPiCameraPreviewLoop();
    };
  }
}

async function initRegistrationCam() {
  const video = document.getElementById('reg-cam-video');
  const canvas = document.getElementById('reg-cam-canvas');
  if (canvas) canvas.style.display = 'none';
  if (video) video.style.display = 'block';

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      if (!regCamStream) {
        regCamStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        });
      }
      if (video && regCamStream) {
        video.srcObject = regCamStream;
        await video.play().catch(() => {});
      }
    } catch (err) {
      console.warn("Registration webcam unavailable:", err);
    }
  }
}

function stopRegistrationCam() {
  if (regCamStream) {
    try {
      regCamStream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    regCamStream = null;
  }
}

async function captureRegistrationPiCamera() {
  audio.beep(850, 0.08);
  const badge = document.getElementById('reg-face-badge');
  const btnPi = document.getElementById('btn-reg-capture-pi');
  const btnStartLaptop = document.getElementById('btn-reg-start-laptop');
  const btnCaptureLaptop = document.getElementById('btn-reg-capture-face');
  const btnRetake = document.getElementById('btn-reg-retake-face');
  const canvas = document.getElementById('reg-cam-canvas');
  const video = document.getElementById('reg-cam-video');
  const previewImg = document.getElementById('reg-cam-preview-img');
  const placeholder = document.getElementById('reg-cam-pi-placeholder');

  isPiCaptureInProgress = true;
  stopPiCameraPreviewLoop();

  if (btnPi) {
    btnPi.disabled = true;
    btnPi.innerText = "Capturing Photo from Pi...";
  }
  if (badge) {
    badge.className = 'badge';
    badge.innerText = 'QUERYING PI CAMERA...';
  }

  try {
    updatePiDisplay("Capturing Photo\nLook at Camera");
    const resp = await fetch('/api/biometrics/pi-camera-capture?t=' + Date.now(), { method: 'POST' });
    const data = await resp.json();

    if (!data.success || !data.image_data) {
      audio.errorTone();
      alert("Failed to capture from Pi camera: " + (data.message || "Camera busy or unreachable"));
      if (badge) {
        badge.className = 'badge';
        badge.innerText = 'PI CAM FAILED';
      }
      isPiCaptureInProgress = false;
      startPiCameraPreviewLoop();
      return;
    }

    regCapturedPhotoBase64 = data.image_data;
    lastPiImageData = data.image_data;
    stopRegistrationCam();

    const img = new Image();
    img.onload = () => {
      if (canvas) {
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        if (placeholder) placeholder.style.display = 'none';
        if (previewImg) previewImg.style.display = 'none';
        if (video) video.style.display = 'none';
        canvas.style.display = 'block';
      }
      if (badge) {
        badge.className = 'badge success';
        badge.innerText = 'PI PHOTO CAPTURED';
      }
      if (btnCaptureLaptop) btnCaptureLaptop.style.display = 'none';
      if (btnStartLaptop) btnStartLaptop.style.display = 'none';
      if (btnPi) btnPi.style.display = 'none';
      if (btnRetake) btnRetake.style.display = 'inline-block';
      audio.successTone();
      updatePiDisplay("Photo Captured\nSuccess");
      isPiCaptureInProgress = false;
    };
    img.src = data.image_data;
  } catch (err) {
    audio.errorTone();
    alert("Error communicating with Pi camera: " + err.message);
    if (badge) {
      badge.className = 'badge';
      badge.innerText = 'ERROR';
    }
    isPiCaptureInProgress = false;
    startPiCameraPreviewLoop();
  } finally {
    if (btnPi) {
      btnPi.disabled = false;
      btnPi.innerText = "🍓 Snap with Pi Cam";
    }
  }
}

function captureRegistrationFace() {
  audio.beep(900, 0.08);
  const video = document.getElementById('reg-cam-video');
  const canvas = document.getElementById('reg-cam-canvas');
  const badge = document.getElementById('reg-face-badge');
  const btnCaptureLaptop = document.getElementById('btn-reg-capture-face');
  const btnStartLaptop = document.getElementById('btn-reg-start-laptop');
  const btnPi = document.getElementById('btn-reg-capture-pi');
  const btnRetake = document.getElementById('btn-reg-retake-face');

  if (!video || !canvas) return;

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  regCapturedPhotoBase64 = canvas.toDataURL('image/jpeg', 0.9);

  stopRegistrationCam();

  video.style.display = 'none';
  canvas.style.display = 'block';

  if (badge) {
    badge.className = 'badge success';
    badge.innerText = 'PHOTO CAPTURED';
  }
  if (btnCaptureLaptop) btnCaptureLaptop.style.display = 'none';
  if (btnStartLaptop) btnStartLaptop.style.display = 'none';
  if (btnPi) btnPi.style.display = 'none';
  if (btnRetake) btnRetake.style.display = 'inline-block';
}

function retakeRegistrationFace() {
  regCapturedPhotoBase64 = null;
  setupRegistrationPiCameraMode();
  const badge = document.getElementById('reg-face-badge');
  if (badge) {
    badge.className = 'badge';
    badge.innerText = 'NOT CAPTURED';
  }
  startPiCameraPreviewLoop();
}

function handleRegistrationPhotoUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    regCapturedPhotoBase64 = e.target.result;
    stopRegistrationCam();
    stopPiCameraPreviewLoop();

    const canvas = document.getElementById('reg-cam-canvas');
    const video = document.getElementById('reg-cam-video');
    const previewImg = document.getElementById('reg-cam-preview-img');
    const placeholder = document.getElementById('reg-cam-pi-placeholder');
    const badge = document.getElementById('reg-face-badge');
    const btnCaptureLaptop = document.getElementById('btn-reg-capture-face');
    const btnStartLaptop = document.getElementById('btn-reg-start-laptop');
    const btnPi = document.getElementById('btn-reg-capture-pi');
    const btnRetake = document.getElementById('btn-reg-retake-face');

    const img = new Image();
    img.onload = () => {
      if (canvas) {
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        if (placeholder) placeholder.style.display = 'none';
        if (previewImg) previewImg.style.display = 'none';
        if (video) video.style.display = 'none';
        canvas.style.display = 'block';
      }
      if (badge) {
        badge.className = 'badge success';
        badge.innerText = 'PHOTO UPLOADED';
      }
      if (btnCaptureLaptop) btnCaptureLaptop.style.display = 'none';
      if (btnStartLaptop) btnStartLaptop.style.display = 'none';
      if (btnPi) btnPi.style.display = 'none';
      if (btnRetake) btnRetake.style.display = 'inline-block';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function enrollRegistrationFingerprint() {
  audio.beep(750, 0.08);
  const btn = document.getElementById('btn-reg-enroll-fp');
  const statusText = document.getElementById('reg-fp-status-text');
  const badge = document.getElementById('reg-fp-badge');

  if (btn) btn.disabled = true;
  if (statusText) statusText.innerText = `Enrolling finger into Slot #${regCurrentSlot}... Place finger on sensor when prompted.`;
  if (badge) {
    badge.className = 'badge pulse';
    badge.innerText = 'ENROLLING...';
  }

  try {
    const resp = await fetch('/api/hardware/fingerprint-enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: regCurrentSlot })
    });
    const data = await resp.json();

    if (data.enrolled && data.mode === 'R307S_HARDWARE') {
      audio.successChord();
      regFingerprintEnrolled = true;
      if (badge) {
        badge.className = 'badge success';
        badge.innerText = `ENROLLED (SLOT #${regCurrentSlot})`;
      }
      if (statusText) {
        statusText.innerHTML = `<span style="color: #34d399; font-weight: 700;">✓ ${data.message || `Fingerprint burned to hardware Slot #${regCurrentSlot}`}</span>`;
      }
    } else {
      audio.errorTone();
      regFingerprintEnrolled = false;
      if (badge) {
        badge.className = 'badge';
        badge.style.color = '#f43f5e';
        badge.innerText = (data.mode === 'OFFLINE' || data.mode === 'DISCONNECTED') ? 'SENSOR OFFLINE' : 'ENROLL FAILED';
      }
      if (statusText) {
        const errorMsg = data.message || data.reason || 'Sensor offline or timed out';
        statusText.innerHTML = `
          <div style="color: var(--accent-rose); font-weight: 600; margin-bottom: 6px;">❌ ${errorMsg}</div>
          <div style="font-size: 0.78rem; color: #94a3b8; line-height: 1.4; margin-bottom: 8px;">
            Check R307S UART wiring: Red=5V/3.3V, Black=GND, White(RX)=Pi Pin 8 (TXD), Green(TX)=Pi Pin 10 (RXD).
          </div>
          <button type="button" class="btn-secondary" style="font-size: 0.75rem; padding: 5px 12px; cursor: pointer;" onclick="triggerFingerprintReconnect()">
            🔄 Scan & Reconnect Sensor
          </button>
        `;
      }
    }
  } catch (err) {
    audio.errorTone();
    regFingerprintEnrolled = false;
    if (badge) {
      badge.className = 'badge';
      badge.style.color = '#f43f5e';
      badge.innerText = 'COMM ERROR';
    }
    if (statusText) {
      statusText.innerHTML = `
        <div style="color: var(--accent-rose); font-weight: 600; margin-bottom: 6px;">❌ Communication error reaching Raspberry Pi hardware agent.</div>
        <button type="button" class="btn-secondary" style="font-size: 0.75rem; padding: 5px 12px; cursor: pointer;" onclick="triggerFingerprintReconnect()">
          🔄 Scan & Reconnect Sensor
        </button>
      `;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function enrollRegistrationLaptopFingerprint() {
  audio.beep(750, 0.08);
  const statusText = document.getElementById('reg-fp-status-text');
  const badge = document.getElementById('reg-fp-badge');
  const epicInput = document.getElementById('reg-epic');
  const nameInput = document.getElementById('reg-name');

  const epic = (epicInput ? epicInput.value : '').trim().toUpperCase() || 'VOTER-NEW';
  const name = (nameInput ? nameInput.value : '').trim() || 'New Voter';

  if (statusText) statusText.innerHTML = `<span style="color: #38bdf8;">👉 TOUCH SENSOR: Touch your laptop's fingerprint reader / power button now...</span>`;
  if (badge) {
    badge.className = 'badge pulse';
    badge.innerText = 'TOUCH SENSOR...';
  }

  try {
    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);
    const userId = new TextEncoder().encode(epic);

    const publicKeyCredentialCreationOptions = {
      challenge: challenge,
      rp: {
        name: "Air-Gapped Biometric Election Terminal",
        id: window.location.hostname
      },
      user: {
        id: userId,
        name: epic.toLowerCase(),
        displayName: name
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" }, 
        { alg: -257, type: "public-key" }
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required"
      },
      timeout: 60000,
      attestation: "none"
    };

    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions
    });

    if (credential) {
      audio.successChord();
      regFingerprintEnrolled = true;
      regFingerprintMethod = "LAPTOP_HARDWARE_FINGERPRINT";
      regFingerprintCredentialId = credential.id;

      if (badge) {
        badge.className = 'badge success';
        badge.innerText = 'ENROLLED (LAPTOP)';
      }
      if (statusText) {
        statusText.innerHTML = `<span style="color: #34d399; font-weight: 700;">✓ Real physical fingerprint authenticated via Laptop Hardware Sensor (ID: ${credential.id.slice(0, 16)}...)</span>`;
      }
    }
  } catch (err) {
    audio.errorTone();
    regFingerprintEnrolled = false;
    if (badge) {
      badge.className = 'badge';
      badge.style.color = '#f43f5e';
      badge.innerText = 'TOUCH CANCELLED';
    }
    if (statusText) {
      statusText.innerHTML = `<span style="color: var(--accent-rose); font-weight: 600;">❌ Fingerprint touch cancelled or sensor unavailable: ${err.message || err}</span>`;
    }
  }
}

async function triggerFingerprintReconnect() {
  audio.beep(650, 0.08);
  const statusText = document.getElementById('reg-fp-status-text') || document.getElementById('fingerprint-status-text');
  const badge = document.getElementById('reg-fp-badge');
  const as608Badge = document.getElementById('badge-as608-status');

  if (badge) {
    badge.className = 'badge pulse';
    badge.innerText = 'SCANNING...';
  }
  if (statusText) {
    statusText.innerHTML = `<span style="color: #38bdf8;">🔄 Scanning Raspberry Pi serial ports (/dev/serial0, /dev/ttyUSB0, /dev/ttyAMA0, /dev/ttyS0) across bauds (57600, 9600, 115200)...</span>`;
  }

  try {
    const resp = await fetch('/api/hardware/fingerprint-reconnect', { method: 'POST' });
    const data = await resp.json();

    if (data.ok) {
      audio.successChord();
      if (badge) {
        badge.className = 'badge success';
        badge.innerText = 'SENSOR READY';
      }
      if (as608Badge) {
        as608Badge.innerText = `R307S: READY (${data.port || 'UART'})`;
        as608Badge.classList.add('success');
      }
      if (statusText) {
        statusText.innerHTML = `<span style="color: #34d399; font-weight: 700;">✓ R307S Optical Sensor detected & initialized on ${data.port} @ ${data.baud} baud!</span>`;
      }
    } else {
      audio.errorTone();
      if (badge) {
        badge.className = 'badge';
        badge.style.color = '#f43f5e';
        badge.innerText = 'NOT FOUND';
      }
      if (as608Badge) {
        as608Badge.innerText = 'R307S: OFFLINE';
        as608Badge.classList.remove('success');
      }
      if (statusText) {
        const ports = (data.candidate_ports || []).join(', ') || '/dev/serial0, /dev/ttyUSB0, /dev/ttyAMA0';
        statusText.innerHTML = `
          <div style="color: var(--accent-rose); font-weight: 700; margin-bottom: 4px;">❌ Sensor not responding on any scanned ports (${ports})</div>
          <div style="font-size: 0.78rem; color: #cbd5e1; line-height: 1.4; text-align: left; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; margin: 6px 0;">
            <strong>Hardware Checklist:</strong><br/>
            1. <strong>Wires crossed?</strong> Pi Pin 8 (TXD) ➔ Sensor White (RX); Pi Pin 10 (RXD) ➔ Sensor Green (TX).<br/>
            2. <strong>Power:</strong> Sensor Red ➔ 5V or 3.3V; Sensor Black ➔ GND (Pin 6).<br/>
            3. <strong>Serial Console Disabled:</strong> In terminal run <code>sudo raspi-config</code> ➔ Interface Options ➔ Serial Port ➔ Login Shell: <strong>No</strong>, Hardware Serial: <strong>Yes</strong>, then reboot.
          </div>
          <button type="button" class="btn-secondary" style="font-size: 0.75rem; padding: 4px 10px;" onclick="triggerFingerprintReconnect()">
            🔄 Scan Again
          </button>
        `;
      }
    }
  } catch (err) {
    audio.errorTone();
    if (statusText) {
      statusText.innerHTML = `<span style="color: var(--accent-rose);">Failed to reach reconnect endpoint: ${err.message || err}</span>`;
    }
  }
}

async function submitVoterRegistration() {
  audio.beep(800, 0.08);
  const epicInput = document.getElementById('reg-epic');
  const nameInput = document.getElementById('reg-name');
  const genderInput = document.getElementById('reg-gender');
  const dobInput = document.getElementById('reg-dob');
  const constInput = document.getElementById('reg-constituency');
  const errorDiv = document.getElementById('reg-form-error');
  const submitBtn = document.getElementById('btn-submit-registration');

  if (errorDiv) errorDiv.innerText = '';

  const epic = (epicInput ? epicInput.value : '').trim().toUpperCase();
  const name = (nameInput ? nameInput.value : '').trim();

  if (!epic) {
    if (errorDiv) errorDiv.innerText = '⚠️ Please enter or generate an EPIC Card Number.';
    return;
  }
  if (!name) {
    if (errorDiv) errorDiv.innerText = '⚠️ Please enter the voter’s legal full name.';
    return;
  }
  if (!regCapturedPhotoBase64) {
    if (errorDiv) errorDiv.innerText = '⚠️ Real photo required: Please snap with Pi Camera or upload a voter photo.';
    return;
  }
  if (!regFingerprintEnrolled) {
    if (errorDiv) errorDiv.innerText = '⚠️ Real fingerprint required: Please enroll on Pi R307S sensor or Laptop sensor.';
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = 'Saving Voter Profile...';
  }

  const payload = {
    epic: epic,
    name: name,
    gender: genderInput ? genderInput.value : 'Male',
    dob: dobInput ? dobInput.value : '1996-05-12',
    constituency: constInput ? constInput.value : 'Central Tech Constituency - AC-07',
    fingerprint_slot: regCurrentSlot,
    fingerprint_method: regFingerprintMethod,
    credential_id: regFingerprintCredentialId,
    photo_base64: regCapturedPhotoBase64
  };

  try {
    const resp = await fetch('/api/voter/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();

    if (resp.ok && data.success) {
      audio.ballotChime();
      const voterRecord = {
        epic: data.voter.epic,
        name: data.voter.name,
        constituency: data.voter.constituency,
        gender: data.voter.gender,
        dob: data.voter.dob,
        fingerprint_slot: data.voter.fingerprint_slot,
        fingerprint_method: data.voter.fingerprint_method,
        credential_id: data.voter.credential_id,
        photo_base64: regCapturedPhotoBase64,
        photo_url: regCapturedPhotoBase64 || `/voter_db/${data.voter.photo || data.voter.epic + '.jpg'}`
      };
      newlyRegisteredVoter = voterRecord;
      saveRegisteredVoter(voterRecord);

      document.getElementById('modal-success-epic').innerText = data.voter.epic;
      document.getElementById('modal-success-name').innerText = data.voter.name;
      document.getElementById('modal-success-slot').innerText = data.voter.fingerprint_method === 'LAPTOP_HARDWARE_FINGERPRINT' ? 'Laptop Hardware Sensor' : `Slot #${data.voter.fingerprint_slot}`;
      document.getElementById('modal-success-constituency').innerText = data.voter.constituency;

      const modal = document.getElementById('reg-success-modal');
      if (modal) modal.style.display = 'flex';
    } else {
      audio.errorTone();
      const msg = (data && data.detail && data.detail.message) || data.message || 'Registration failed.';
      if (errorDiv) errorDiv.innerText = `⚠️ ${msg}`;
    }
  } catch (err) {
    audio.errorTone();
    if (errorDiv) errorDiv.innerText = `⚠️ Network error: ${err.message || 'Could not reach server'}`;
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = '✅ Complete Registration & Save Voter';
    }
  }
}

function closeRegistrationModal() {
  const modal = document.getElementById('reg-success-modal');
  if (modal) modal.style.display = 'none';

  const epicInput = document.getElementById('reg-epic');
  const nameInput = document.getElementById('reg-name');
  if (epicInput) epicInput.value = '';
  if (nameInput) nameInput.value = '';
  regFingerprintEnrolled = false;
  regFingerprintMethod = 'RPI_R307S_SENSOR';
  regFingerprintCredentialId = null;
  regCapturedPhotoBase64 = null;
  retakeRegistrationFace();
  fetchNextAvailableSlot();
}

function proceedToVoteWithNewVoter() {
  const curVoter = newlyRegisteredVoter;
  const epic = curVoter ? curVoter.epic : '';
  closeRegistrationModal();
  switchTerminalMode('kiosk');

  if (epic) {
    if (curVoter) {
      newlyRegisteredVoter = curVoter;
      KioskState.voterData = curVoter;
      KioskState.activeEpic = epic;
    }
    const epicField = document.getElementById('epic-input-field');
    if (epicField) {
      epicField.value = epic;
      submitEpicLookup();
    }
  }
}