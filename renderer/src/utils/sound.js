// renderer/src/utils/sound.js
//
// Synthesizes short beep sequences using the Web Audio API instead of
// Electron's native shell.beep() (main.js's `notify:beep` IPC). The native
// beep is a single flat OS sound with no control over pitch/timing — fine
// for "something went wrong," but can't make an actual sequence. This runs
// entirely in the renderer, needs no audio files, and works fully offline.

let audioCtx = null;

function getContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Chromium can start an AudioContext "suspended" until a user gesture has
  // occurred on the page. resume() is a harmless no-op if it's already running.
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(freq, startTime, duration, ctx, gainPeak = 0.15) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine'; // soft, not a harsh buzzer
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.008); // quick attack, avoids a click/pop
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration); // smooth fade-out

  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

/** Two-note ascending chime (C5 -> E5). This is the general-purpose
 *  notification sound — use this for in-app notifications (record saved,
 *  sync events, etc.) that aren't login. */
export function playNotificationChime() {
  const ctx = getContext();
  const now = ctx.currentTime;
  playTone(523.25, now, 0.14, ctx);
  playTone(659.25, now + 0.12, 0.18, ctx);
}

// Layers a triangle wave (body) with a quieter octave-up sine (shimmer) and
// a quiet octave-down sine (weight) — a plain sine reads as thin/beepy;
// this three-layer stack is what gives it a fuller, "Windows chime" quality.
function playThickTone(freq, startTime, duration, ctx, gainPeak = 0.22) {
  const body = ctx.createOscillator();
  const shimmer = ctx.createOscillator();
  const weight = ctx.createOscillator();
  const shimmerGain = ctx.createGain();
  const weightGain = ctx.createGain();
  const mainGain = ctx.createGain();

  body.type = 'triangle';
  body.frequency.value = freq;
  shimmer.type = 'sine';
  shimmer.frequency.value = freq * 2;
  shimmerGain.gain.value = 0.3;
  weight.type = 'sine';
  weight.frequency.value = freq / 2;
  weightGain.gain.value = 0.25;

  mainGain.gain.setValueAtTime(0, startTime);
  mainGain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.015);
  mainGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  body.connect(mainGain);
  shimmer.connect(shimmerGain).connect(mainGain);
  weight.connect(weightGain).connect(mainGain);
  mainGain.connect(ctx.destination);

  [body, shimmer, weight].forEach((osc) => {
    osc.start(startTime);
    osc.stop(startTime + duration);
  });
}

/** Same ascending two-note shape as playNotificationChime (C5 -> E5) so it
 *  reads as part of the same sonic family, but layered/thicker for a
 *  fuller, more "Windows startup chime" quality — reserved specifically
 *  for login success, a bigger moment than a routine notification. */
function playSynthesizedLoginChime() {
  const ctx = getContext();
  const now = ctx.currentTime;
  playThickTone(523.25, now, 0.2, ctx, 0.22);
  playThickTone(659.25, now + 0.14, 0.32, ctx, 0.26);
}

// ---------------------------------------------------------------------------
// Real login sound file — drop the actual audio file at
// assets/sounds/login.mp3 (project root, sibling to renderer/, same
// convention already used for icon.png/logo.png). Created once here rather
// than on every call, so there's no loading delay the moment login
// actually succeeds — it's already buffered and ready.
// ---------------------------------------------------------------------------
const loginAudio = new Audio('../assets/sounds/login.mp3');
loginAudio.preload = 'auto';
loginAudio.volume = 0.6;

export function playLoginSuccessChime() {
  // .play() returns a Promise that rejects if the file is missing, still
  // loading, or blocked by the browser — falls back to the synthesized
  // chime in any of those cases, so login is never silently silent.
  loginAudio.currentTime = 0; // restart from the beginning if triggered again quickly
  const playPromise = loginAudio.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch((err) => {
      console.warn('Could not play login.mp3, falling back to the synthesized chime:', err.message);
      playSynthesizedLoginChime();
    });
  }
}