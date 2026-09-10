/**
 * Air-Gapped Biometric Voting Kiosk - Frontend State Machine
 * Screen States:
 * 1. STATE_EPIC_INPUT
 * 2. STATE_FACIAL_SCAN
 * 3. STATE_FINGERPRINT
 * 4. STATE_BALLOT_SELECTION
 * 5. STATE_CONFIRMATION
 */

// Sound Synthesizer for tactile touch feedback
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
      // Audio not permitted without interaction
    }
  }

  successChord() {
    this.beep(523.25, 0.1); // C5
    setTimeout(() => this.beep(659.25, 0.1), 80); // E5
    setTimeout(() => this.beep(783.99, 0.2), 160); // G5
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

// Application State
const KioskState = {
  currentStep: 1,
  activeEpic: '',
  voterData: null,
  ephemeralToken: null,
  candidates: [],
  selectedCandidate: null,
  autoResetTimer: null
};

// DOM References
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

// Switch between screen states
function setScreenState(stepNumber) {
  KioskState.currentStep = stepNumber;

  // Update screens
  Object.keys(screens).forEach(step => {
    if (parseInt(step) === stepNumber) {
      screens[step].classList.add('active');
    } else {
      screens[step].classList.remove('active');
    }
  });

  // Update Stepper
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
  if (stepNumber === 2) {
    initWebcamStream();
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

// -------------------------------------------------------------
// STEP 1: Voter Identity & EPIC Lookup
// -------------------------------------------------------------
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

    // Populate Step 2 Profile
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

// -------------------------------------------------------------
// STEP 2: Facial Recognition HUD
// -------------------------------------------------------------
async function triggerFaceVerify() {
  audio.beep(600, 0.08);
  const scanBtn = document.getElementById('btn-capture-face');
  const statusBadge = document.getElementById('face-scan-status');
  const confidenceFill = document.getElementById('face-confidence-fill');
  const confidenceText = document.getElementById('face-confidence-text');

  scanBtn.disabled = true;
  scanBtn.innerText = "Analyzing Biometric Features...";
  statusBadge.innerText = "Capturing Face & Liveness...";

  try {
    const resp = await fetch('/api/biometrics/face-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epic: KioskState.activeEpic })
    });

    const data = await resp.json();
    const ver = data.verification;

    if (ver.status === "MATCH_SUCCESS") {
      audio.successChord();
      confidenceFill.style.width = `${ver.match_score}%`;
      confidenceText.innerText = `${ver.match_score}%`;
      statusBadge.className = "badge success";
      statusBadge.innerText = `VERIFIED: ${ver.message}`;

      setTimeout(() => {
        setScreenState(3); // Advance to Fingerprint
      }, 1200);
    } else {
      audio.errorTone();
      confidenceFill.style.width = `${ver.match_score}%`;
      confidenceText.innerText = `${ver.match_score}%`;
      statusBadge.className = "badge";
      statusBadge.style.borderColor = "var(--accent-rose)";
      statusBadge.style.color = "var(--accent-rose)";
      statusBadge.innerText = `REJECTED: ${ver.message}`;
      scanBtn.disabled = false;
      scanBtn.innerText = "Retry Facial Verification";
    }
  } catch (err) {
    audio.errorTone();
    statusBadge.innerText = "Camera evaluation error";
    scanBtn.disabled = false;
    scanBtn.innerText = "Retry Facial Verification";
  }
}

// -------------------------------------------------------------
// STEP 3: Physical Fingerprint Verification (Laptop Power Button & AS608)
// -------------------------------------------------------------

// Trigger laptop built-in physical fingerprint sensor (Power Button / Windows Hello)
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
    // Generate secure challenge
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
        { alg: -7, type: "public-key" },  // ES256
        { alg: -257, type: "public-key" } // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform", // LAPTOP POWER BUTTON FINGERPRINT SENSOR
        userVerification: "required"         // ENFORCES PHYSICAL BIOMETRIC TOUCH
      },
      timeout: 60000,
      attestation: "none"
    };

    // This immediately summons the native Windows Hello fingerprint prompt!
    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions
    });

    if (credential) {
      // Physical finger on power button verified by laptop biometric hardware!
      audio.successChord();
      if (graphic) {
        graphic.classList.remove('scanning');
        graphic.classList.add('success');
      }
      statusText.innerHTML = `<span style="color: #34d399; font-weight: bold;">✓ PHYSICAL FINGERPRINT CONFIRMED (Laptop Power Button Sensor)</span>`;
      if (subtext) subtext.innerText = `Hardware ID: ${credential.id.slice(0, 24)}... (Verified via Windows Hello)`;

      // Dispatch to backend
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

// Trigger External AS608 UART Optical Sensor
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

// -------------------------------------------------------------
// STEP 4: Ballot Candidate Selection & Authorization
// -------------------------------------------------------------
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
    setScreenState(4); // Advance to Candidate Ballot screen!
  } catch (err) {
    console.error("Error unlocking ballot:", err);
    alert("Error initializing ballot access.");
  }
}

function renderCandidates(candidates) {
  const container = document.getElementById('candidates-list-container');
  if (!container) return;
  container.innerHTML = '';

  candidates.forEach(cand => {
    const card = document.createElement('div');
    card.className = 'candidate-card';
    card.innerHTML = `
      <div style="display: flex; align-items: center;">
        <div class="cand-symbol-box">${cand.symbol}</div>
        <div class="cand-info">
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
    setScreenState(5); // Advance to Receipt screen!
  } catch (err) {
    audio.errorTone();
    alert("Blockchain dispatch failed: Check local Web3 network.");
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerText = "CONFIRM & CAST BALLOT";
    }
  }
}

// -------------------------------------------------------------
// STEP 5: VVPAT Cryptographic Confirmation Receipt
// -------------------------------------------------------------
function showConfirmationReceipt(receipt) {
  audio.successChord();
  document.getElementById('rcpt-candidate').innerText = `${receipt.symbol} ${receipt.candidate_name}`;
  document.getElementById('rcpt-party').innerText = receipt.party;
  document.getElementById('rcpt-timestamp').innerText = new Date(receipt.timestamp * 1000).toLocaleString();
  document.getElementById('rcpt-nonce').innerText = receipt.ballot_nonce;
  document.getElementById('rcpt-hash').innerText = receipt.salted_voter_hash;
  document.getElementById('rcpt-zkproof').innerText = receipt.zk_proof_receipt;
  document.getElementById('rcpt-status').innerText = receipt.ledger_status;

  // Clear any previous timer completely: Voter stays on receipt screen until they choose to exit
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

  // Reset graphics and progress
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

// Check hardware diagnostic on load
async function checkSystemDiagnostic() {
  try {
    const resp = await fetch('/api/system/status');
    const data = await resp.json();
    const as608Badge = document.getElementById('badge-as608-status');
    if (as608Badge && data.hardware?.as608_fingerprint_scanner) {
      const mode = data.hardware.as608_fingerprint_scanner.active_mode;
      as608Badge.innerText = `AS608: ${mode}`;
    }
  } catch (e) {
    console.warn("System diagnostic unreachable", e);
  }
}

// Initialise
window.addEventListener('DOMContentLoaded', () => {
  setScreenState(1);
  checkSystemDiagnostic();
  initSensorTouchListeners();
});
