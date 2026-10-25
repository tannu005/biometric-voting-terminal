

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
  autoResetTimer: null
};

const screens = {
  1: document.getElementById('screen-epic'),
  2: document.getElementById('screen-face'),
  3: document.getElementById('screen-fingerprint'),
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
    updatePiDisplay("Facial Scan\nLook at Camera");
    initWebcamStream();
    startAutomaticFaceTracker();
  } else if (stepNumber === 3) {
    stopAutomaticFaceTracker();
    updatePiDisplay("Place Finger on\nR307S Sensor");
  } else if (stepNumber === 4) {
    stopAutomaticFaceTracker();
    updatePiDisplay("Select Candidate\nPress Switch");
  } else if (stepNumber === 5) {
    stopAutomaticFaceTracker();
    updatePiDisplay("Ballot Cast OK\nPrinting Receipt");
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

  try {
    const resp = await fetch('/api/voter/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epic: epic })
    });

    const data = await resp.json();
    if (!resp.ok) {
      audio.errorTone();
      showEpicError(data.detail?.message || "Voter verification rejected.");
      submitBtn.disabled = false;
      submitBtn.innerText = "Verify Voter Identity →";
      return;
    }

    audio.successChord();
    KioskState.activeEpic = epic;
    KioskState.voterData = data.voter;

    document.getElementById('hud-voter-name').innerText = data.voter.name;
    document.getElementById('hud-voter-epic').innerText = data.voter.epic;
    document.getElementById('hud-voter-constituency').innerText = data.voter.constituency;
    document.getElementById('hud-voter-photo').src = data.voter.photo_url;

    setScreenState(2);
  } catch (err) {
    audio.errorTone();
    showEpicError("Network/Hardware error connecting to local terminal service.");
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
    if (KioskState.currentStep !== 2 || isVerifyingFace) return;
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
          await executeFaceVerification(fullFrame);
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
  const statusBadge = document.getElementById('face-scan-status');
  const confidenceFill = document.getElementById('face-confidence-fill');
  const confidenceText = document.getElementById('face-confidence-text');
  const label = document.getElementById('auto-detect-label');

  if (scanBtn) {
    scanBtn.disabled = true;
    scanBtn.innerText = 'Analyzing Biometric Features...';
  }
  if (statusBadge) statusBadge.innerText = 'Evaluating Face...';

  try {
    const resp = await fetch('/api/biometrics/face-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        epic: KioskState.activeEpic,
        image_data: imageData
      })
    });

    const data = await resp.json();
    const ver = data.verification;

    if (ver.status === 'MATCH_SUCCESS') {
      audio.successChord();
      if (confidenceFill) confidenceFill.style.width = ver.match_score + '%';
      if (confidenceText) confidenceText.innerText = ver.match_score + '%';
      if (statusBadge) {
        statusBadge.className = 'badge success';
        statusBadge.innerText = 'VERIFIED: ' + ver.match_score + '%';
      }
      if (label) label.innerText = '✓ Identity Verified: ' + ver.message;

      updatePiDisplay('Face Verified\nAdvance Step 3');

      setTimeout(() => {
        setScreenState(3);
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
        scanBtn.innerText = 'Retry Facial Verification';
      }

      setTimeout(() => {
        isVerifyingFace = false;
        if (KioskState.currentStep === 2) {
          startAutomaticFaceTracker();
        }
      }, 2500);
    }
  } catch (err) {
    audio.errorTone();
    if (statusBadge) statusBadge.innerText = 'Camera evaluation error';
    if (scanBtn) {
      scanBtn.disabled = false;
      scanBtn.innerText = 'Retry Facial Verification';
    }
    setTimeout(() => {
      isVerifyingFace = false;
      if (KioskState.currentStep === 2) {
        startAutomaticFaceTracker();
      }
    }, 2500);
  }
}

async function triggerFaceVerify() {
  audio.beep(600, 0.08);
  const videoEl = document.getElementById('client-webcam-feed');
  const frame = captureWebcamFrameBase64(videoEl);
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
          method: "LAPTOP_HARDWARE_FINGERPRINT",
          credential: {
            id: credential.id,
            type: credential.type
          }
        })
      });

      const data = await resp.json();
      if (data.verification?.status === "MATCH_SUCCESS") {
        setTimeout(async () => {
          await unlockBallot();
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
      updatePiDisplay("Fingerprint OK\nBallot Unlocked");
      setTimeout(async () => {
        await unlockBallot();
      }, 900);
    } else {
      audio.errorTone();
      if (graphic) graphic.classList.remove('scanning');
      statusText.innerHTML = `<span style="color: var(--accent-rose); font-weight: 600;">MATCH_FAIL: ${ver.message}</span>`;
      updatePiDisplay("Match Fail\nTry Again");
    }
  } catch (err) {
    audio.errorTone();
    if (graphic) graphic.classList.remove('scanning');
    statusText.innerText = "Raspberry Pi Ethernet communication timeout.";
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
      setTimeout(async () => {
        await unlockBallot();
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
      body: JSON.stringify({ epic: KioskState.activeEpic })
    });

    const data = await resp.json();
    if (!resp.ok) {
      audio.errorTone();
      alert(data.detail?.message || "Dual-biometric authorization rejected.");
      setScreenState(1);
      return;
    }

    KioskState.ephemeralToken = data.ephemeral_token;
    KioskState.candidates = data.candidates;

    renderCandidates(data.candidates);
    setScreenState(4);
  } catch (err) {
    console.error("Error unlocking ballot:", err);
    alert("Error initializing ballot access.");
  }
}

function renderCandidates(candidates) {
  const container = document.getElementById('candidates-list-container');
  if (!container) return;
  container.innerHTML = '';

  highlightedCandidateIndex = 0;

  candidates.forEach((cand, idx) => {
    const card = document.createElement('div');
    card.className = idx === 0 ? 'candidate-card keyboard-highlighted' : 'candidate-card';
    const contractNum = cand.contract_id !== undefined ? cand.contract_id : idx;
    card.innerHTML = `
      <div style="display: flex; align-items: center;">
        <div class="cand-symbol-box">${cand.symbol}</div>
        <div class="cand-info">
          <div style="font-size: 0.72rem; color: #38bdf8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Candidate #${contractNum} (Contract Slot)</div>
          <h3>${cand.name}</h3>
          <p>${cand.party}</p>
        </div>
      </div>
      <button class="vote-press-btn" onclick="openVoteConfirmation('${cand.id}')">VOTE [TOUCH]</button>
    `;
    container.appendChild(card);
  });
}

function openVoteConfirmation(candidateId) {
  audio.beep(800, 0.08);
  const cand = KioskState.candidates.find(c => c.id === candidateId);
  if (!cand) return;

  KioskState.selectedCandidate = cand;

  document.getElementById('modal-cand-symbol').innerText = cand.symbol;
  document.getElementById('modal-cand-name').innerText = cand.name;
  document.getElementById('modal-cand-party').innerText = cand.party;

  const modal = document.getElementById('vote-modal');
  if (modal) modal.style.display = 'flex';
}

function closeVoteConfirmation() {
  audio.beep(400, 0.05);
  const modal = document.getElementById('vote-modal');
  if (modal) modal.style.display = 'none';
}

async function executeCastVote() {
  audio.ballotChime();
  const confirmBtn = document.getElementById('btn-confirm-vote');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerText = "Signing & Casting...";
  }

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

    const data = await resp.json();
    if (!resp.ok) {
      audio.errorTone();
      alert(data.detail?.message || "Transaction broadcast failed.");
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerText = "CONFIRM & CAST BALLOT";
      }
      return;
    }

    closeVoteConfirmation();
    showConfirmationReceipt(data.receipt);
    setScreenState(5);
  } catch (err) {
    audio.errorTone();
    alert("Blockchain dispatch failed: Check local Web3 network.");
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

async function checkSystemDiagnostic() {
  try {
    const resp = await fetch('/api/system/status');
    const data = await resp.json();
    const as608Badge = document.getElementById('badge-as608-status');
    if (as608Badge && data.hardware?.as608_fingerprint_scanner) {
      const mode = data.hardware.as608_fingerprint_scanner.active_mode;
      as608Badge.innerText = `R307S/AS608: ${mode}`;
    }
  } catch (e) {
    console.warn("System diagnostic unreachable", e);
  }

  try {
    const hwResp = await fetch('/api/hardware/health');
    if (hwResp.ok) {
      const hwData = await hwResp.json();
      const piBadge = document.getElementById('badge-pi-status');
      if (piBadge) {
        if (hwData.connected && hwData.pi?.status === 'READY') {
          piBadge.innerText = "PI: 192.168.50.2 (ONLINE)";
          piBadge.classList.add('success');
        } else {
          piBadge.innerText = "PI: LOCAL MODE";
          piBadge.classList.remove('success');
        }
      }
    }
  } catch (e) {}
}

let highlightedCandidateIndex = 0;
let hardwarePollingInterval = null;

function updateCandidateHighlight(cards) {
  cards.forEach((c, idx) => {
    if (idx === highlightedCandidateIndex) {
      c.classList.add('keyboard-highlighted');
      c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      c.classList.remove('keyboard-highlighted');
    }
  });
}

function handlePhysicalSwitchEvent(switchName) {
  audio.beep(880, 0.05);
  const currentScreen = KioskState.currentStep;

  if (currentScreen === 1) {
    if (switchName === 'switch_2') {
      const epics = ['VOTE-IND-2026-001', 'VOTE-IND-2026-002', 'VOTE-IND-2026-003', 'VOTE-IND-2026-004'];
      const current = document.getElementById('epic-input-field').value.trim();
      let nextIdx = (epics.indexOf(current) + 1) % epics.length;
      selectQuickEpic(epics[nextIdx]);
    } else if (switchName === 'switch_3') {
      submitEpic();
    }
  } else if (currentScreen === 2) {
    if (switchName === 'switch_3') {
      triggerFacialVerification();
    }
  } else if (currentScreen === 3) {
    if (switchName === 'switch_3') {
      triggerRpiR307SFingerprint();
    }
  } else if (currentScreen === 4) {
    const modal = document.getElementById('vote-modal');
    const isModalOpen = modal && modal.style.display === 'flex';

    if (isModalOpen) {
      if (switchName === 'switch_1') {
        closeVoteConfirmation();
      } else if (switchName === 'switch_3') {
        executeCastVote();
      }
    } else {
      const cards = document.querySelectorAll('.candidate-card');
      if (!cards || cards.length === 0) return;

      if (switchName === 'switch_1') {
        highlightedCandidateIndex = (highlightedCandidateIndex - 1 + cards.length) % cards.length;
        updateCandidateHighlight(cards);
      } else if (switchName === 'switch_2') {
        highlightedCandidateIndex = (highlightedCandidateIndex + 1) % cards.length;
        updateCandidateHighlight(cards);
      } else if (switchName === 'switch_3') {
        if (KioskState.candidates && KioskState.candidates[highlightedCandidateIndex]) {
          openVoteConfirmation(KioskState.candidates[highlightedCandidateIndex].id);
        }
      }
    }
  } else if (currentScreen === 5) {
    if (switchName === 'switch_3') {
      resetKioskForNextVoter();
    }
  }
}

function startHardwareEventPolling() {
  if (hardwarePollingInterval) clearInterval(hardwarePollingInterval);
  hardwarePollingInterval = setInterval(async () => {
    try {
      const resp = await fetch('/api/hardware/events');
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.events && Array.isArray(data.events)) {
        for (const ev of data.events) {
          if (ev.type === 'switch_pressed' && ev.switch) {
            handlePhysicalSwitchEvent(ev.switch);
          }
        }
      }
    } catch (e) {}
  }, 600);
}

window.addEventListener('DOMContentLoaded', () => {
  setScreenState(1);
  checkSystemDiagnostic();
  initSensorTouchListeners();
  startHardwareEventPolling();
});