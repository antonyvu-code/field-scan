import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import signalsData from './signals.json';

gsap.registerPlugin(ScrollTrigger);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Clock ---------- */
const clockEl = document.getElementById('clock');
function tickClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  clockEl.textContent = `${hh}:${mm}:${ss}`;
}
tickClock();
setInterval(tickClock, 1000);

/* ---------- Scroll cue ---------- */
document.getElementById('scroll-cue').addEventListener('click', () => {
  document.querySelector('.signals').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
});

/* ---------- Log entries reveal ---------- */
gsap.utils.toArray('.log-entry').forEach((entry) => {
  gsap.to(entry, {
    opacity: 1,
    y: 0,
    duration: reduceMotion ? 0.01 : 0.9,
    ease: 'power2.out',
    scrollTrigger: {
      trigger: entry,
      start: 'top 82%',
      once: true,
    },
  });
});

/* ---------- Scan canvas ---------- */
const canvas = document.getElementById('scan-canvas');
const ctx = canvas.getContext('2d');
const hero = document.querySelector('.hero');
const hudBox = document.querySelector('.hud');
const hud = document.getElementById('hud-readout');
const hudSr = document.getElementById('hud-sr');
const hint = document.getElementById('hero-hint');
const strengthFill = document.getElementById('strength-fill');
const strengthVal = document.getElementById('strength-val');

/* ---------- Inspect mode + telemetry ---------- */
const inspectToggle = document.getElementById('inspect-toggle');
const telemetry = document.getElementById('telemetry');
const tmFps = document.getElementById('tm-fps');
const tmStr = document.getElementById('tm-str');
const tmBlips = document.getElementById('tm-blips');
const tmLock = document.getElementById('tm-lock');
const tmDays = document.getElementById('tm-days');
tmDays.textContent = String(signalsData.meta.digestDays);
let inspectOn = false;

inspectToggle.addEventListener('click', () => {
  inspectOn = !inspectOn;
  document.body.classList.toggle('inspect', inspectOn);
  inspectToggle.setAttribute('aria-pressed', String(inspectOn));
  telemetry.hidden = !inspectOn;
});

/* ---------- Web Audio — a short blip on each signal lock ---------- */
// Opt-in only: the AudioContext is created inside the toggle's click handler so it
// counts as a user gesture (autoplay policy), and sound stays off until asked for.
const soundToggle = document.getElementById('sound-toggle');
let soundOn = false;
let audioCtx = null;
// Pentatonic steps (semitones) so consecutive locks never sound dissonant.
const PENTA = [0, 3, 5, 7, 10];

soundToggle.addEventListener('click', () => {
  soundOn = !soundOn;
  soundToggle.setAttribute('aria-pressed', String(soundOn));
  if (soundOn && !audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (soundOn && audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
});

function playBlip(index) {
  if (!soundOn || !audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const semitone = PENTA[index % PENTA.length] + (index >= PENTA.length ? 12 : 0);
  osc.type = 'sine';
  osc.frequency.value = 523.25 * Math.pow(2, semitone / 12); // C5 root
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.14, now + 0.005); // fast attack
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16); // short decay
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.18);
}

// Single source of truth — generated/validated from the real digest by
// scripts/generate-signals.mjs. Feeds the canvas blips, the accessible list, and
// the inspect telemetry alike.
const SIGNALS = signalsData.signals.map((s) => s.label);

let width = 0;
let height = 0;
let blips = [];
let pointer = { x: -9999, y: -9999, active: false };
let lastPointer = { x: 0, y: 0 };
let lockedIndex = -1;
let rafId = null;
let autoSweepT = 0;
let afterglow = 0; // 1 right after the cursor leaves, decays to 0
let lastFrame = performance.now();
let fpsSmooth = 60;
let lastStrPct = -1; // last strength % written to the DOM
let tmAccum = 0; // throttle telemetry text writes

function resize() {
  const rect = hero.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cols = 7;
  const rows = 4;
  blips = SIGNALS.map((label, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const jitterX = (Math.sin(i * 12.9898) * 0.5 + 0.5) * 0.5;
    const jitterY = (Math.sin(i * 78.233) * 0.5 + 0.5) * 0.5;
    return {
      label,
      x: ((col + 0.5 + jitterX * 0.4) / cols) * width,
      y: ((row + 0.5 + jitterY * 0.4) / (rows + 1) + 0.15) * height,
      // Deterministic phase so resizing doesn't make the pulses jump.
      phase: (Math.sin(i * 42.17) * 0.5 + 0.5) * Math.PI * 2,
    };
  });
}

function draw(time) {
  ctx.clearRect(0, 0, width, height);

  // grid
  ctx.strokeStyle = 'rgba(57,255,143,0.05)';
  ctx.lineWidth = 1;
  const gridStep = 48;
  for (let x = 0; x < width; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // delta-time (seconds) — drives afterglow decay and FPS, frame-rate independent
  const dt = Math.min((time - lastFrame) / 1000, 0.05);
  lastFrame = time;

  let px;
  let py;
  let beamAlpha = 1;
  const scanRadius = 190;

  if (pointer.active) {
    px = pointer.x;
    py = pointer.y;
    lastPointer.x = px;
    lastPointer.y = py;
  } else if (afterglow > 0) {
    // §5 after-glow — beam lingers at the last cursor spot, shrinking + fading
    afterglow = Math.max(0, afterglow - dt / 0.6);
    px = lastPointer.x;
    py = lastPointer.y;
    beamAlpha = afterglow;
  } else {
    // idle auto-sweep (Lissajous), disabled under reduced-motion
    autoSweepT += reduceMotion ? 0 : dt * 0.36;
    px = width * 0.5 + Math.cos(autoSweepT) * width * 0.32;
    py = height * 0.55 + Math.sin(autoSweepT * 1.3) * height * 0.22;
  }

  const beamRadius = scanRadius * (afterglow > 0 && !pointer.active ? afterglow : 1);
  let nearest = -1;
  let nearestDist = Infinity;

  blips.forEach((b, i) => {
    const dx = b.x - px;
    const dy = b.y - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const inRange = dist < beamRadius;
    if (inRange && dist < nearestDist) {
      nearestDist = dist;
      nearest = i;
    }

    const pulse = 0.6 + 0.4 * Math.sin(time * 0.003 + b.phase);
    const r = inRange ? 3.2 + pulse * 1.6 : 1.6;
    const alpha = inRange ? 0.9 : 0.22;

    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(57,255,143,${alpha})`;
    ctx.fill();

    if (inRange) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(57,255,143,${0.35 * beamAlpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });

  // signal strength — real telemetry: 1 − clamp(distance / radius)
  const strength = nearest >= 0 ? 1 - Math.min(nearestDist / beamRadius, 1) : 0;

  // scan beam glow (radius + alpha follow the afterglow)
  if (beamRadius > 1) {
    const grad = ctx.createRadialGradient(px, py, 0, px, py, beamRadius);
    grad.addColorStop(0, `rgba(57,255,143,${0.16 * beamAlpha})`);
    grad.addColorStop(0.7, `rgba(57,255,143,${0.05 * beamAlpha})`);
    grad.addColorStop(1, 'rgba(57,255,143,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, beamRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, beamRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(57,255,143,${0.18 * beamAlpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // strength bar — write to the DOM only when the integer % actually changes
  const strPct = Math.round(strength * 100);
  if (strPct !== lastStrPct) {
    lastStrPct = strPct;
    strengthFill.style.width = `${strPct}%`;
    strengthVal.textContent = `${String(strPct).padStart(2, '0')}%`;
  }

  // HUD text + border state change only when the locked signal actually changes
  if (nearest !== lockedIndex) {
    lockedIndex = nearest;
    if (lockedIndex >= 0) {
      hud.textContent = `SIGNAL LOCKED — ${blips[lockedIndex].label}`;
      hudBox.classList.add('is-locked');
      if (hint) hint.style.opacity = '0';
      playBlip(lockedIndex);
      // Announce to screen readers only for user-driven locks, not the idle sweep.
      if (pointer.active) hudSr.textContent = `Signal locked — ${blips[lockedIndex].label}`;
    } else {
      hud.textContent = pointer.active ? 'SCANNING — no signal locked' : 'STANDBY — no signal locked';
      hudBox.classList.remove('is-locked');
    }
  }

  // FPS (smoothed) + telemetry text — throttled to ~4 writes/sec, and only in inspect mode
  fpsSmooth += ((dt > 0 ? 1 / dt : 60) - fpsSmooth) * 0.1;
  tmAccum += dt;
  if (inspectOn && tmAccum > 0.25) {
    tmAccum = 0;
    tmFps.textContent = String(Math.round(fpsSmooth));
    tmStr.textContent = strength.toFixed(2);
    tmBlips.textContent = String(blips.length);
    tmLock.textContent = lockedIndex >= 0 ? `#${lockedIndex}` : 'null';
  }

  rafId = requestAnimationFrame(draw);
}

function onPointerMove(e) {
  const rect = hero.getBoundingClientRect();
  pointer.x = e.clientX - rect.left;
  pointer.y = e.clientY - rect.top;
  pointer.active = true;
  afterglow = 0;
}
function onPointerLeave() {
  if (pointer.active) afterglow = 1; // trigger the after-glow decay
  pointer.active = false;
}

hero.addEventListener('pointermove', onPointerMove);
hero.addEventListener('pointerleave', onPointerLeave);
hero.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches[0]) onPointerMove(e.touches[0]);
  },
  { passive: true }
);

// ResizeObserver fires once layout is ready (avoids the init-time 0×0 race) and on
// element size changes; the window listener is the belt-and-suspenders for viewport
// resizes (and covers environments that defer RO delivery while the tab is hidden).
const ro = new ResizeObserver(resize);
ro.observe(hero);
window.addEventListener('resize', resize);
resize();
rafId = requestAnimationFrame(draw);

window.addEventListener('beforeunload', () => {
  if (rafId) cancelAnimationFrame(rafId);
  ro.disconnect();
});
