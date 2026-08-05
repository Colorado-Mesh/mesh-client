/**
 * LXST call progress tones (dial / ringback / busy / fail) via Web Audio.
 * Honors global chat notification mute (`mesh-client:notifMuted`).
 */

import { CHAT_NOTIF_MUTED_STORAGE_KEY } from '@/renderer/lib/chatInactiveNotifications';

let sharedAudioContext: AudioContext | null = null;
let ringbackTimer: ReturnType<typeof setInterval> | null = null;
let busyStopTimer: ReturnType<typeof setTimeout> | null = null;
/** Continuous dial-tone oscillators (350+440 Hz); stopped via stopVoiceCallTones. */
let dialOscillators: OscillatorNode[] = [];
let dialGain: GainNode | null = null;

/** Outbound connect sequence: 2s dial → DTMF → modem handshake → carrier. */
let connectSequenceActive = false;
let connectSequenceHash: string | null = null;
let dialPhaseTimer: ReturnType<typeof setTimeout> | null = null;
let dtmfToModemTimer: ReturnType<typeof setTimeout> | null = null;

/** Modem handshake / carrier soundscape nodes (stopped on promote / hangup). */
let modemStoppables: { stop: (when?: number) => void; disconnect: () => void }[] = [];
let modemDisconnectables: { disconnect: () => void }[] = [];
let modemCarrierStartTimer: ReturnType<typeof setTimeout> | null = null;
let modemHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

const OUTGOING_DIAL_MS = 2000;
const DTMF_ON_S = 0.12;
const DTMF_GAP_S = 0.06;
/** 4 × on + 3 × gap (last gap omitted) = 660ms. */
export const DTMF_BURST_MS = Math.round(4 * DTMF_ON_S * 1000 + 3 * DTMF_GAP_S * 1000);
/** Silence after last DTMF digit before modem handshake. */
export const DTMF_TO_RING_GAP_MS = 250;

const MODEM_ANSWER_S = 0.45;
const MODEM_CHIRP_S = 0.35;
const MODEM_TRAIN_S = 0.5;
/** Wall-clock duration of one-shot handshake before carrier bed starts. */
export const MODEM_HANDSHAKE_MS = Math.round(
  (MODEM_ANSWER_S + MODEM_CHIRP_S + MODEM_TRAIN_S) * 1000,
);
const MODEM_HEARTBEAT_MS = 2800;
const MODEM_HEARTBEAT_CHIRP_S = 0.18;

/** Standard DTMF keypad: nybble 0–F → 0–9, A–D, *, #. */
const DTMF_KEY_BY_NYBBLE = '0123456789ABCD*#' as const;

/** Classic DTMF row+col Hz per key. */
const DTMF_FREQS: Readonly<Record<string, readonly [number, number]>> = {
  '1': [697, 1209],
  '2': [697, 1336],
  '3': [697, 1477],
  A: [697, 1633],
  '4': [770, 1209],
  '5': [770, 1336],
  '6': [770, 1477],
  B: [770, 1633],
  '7': [852, 1209],
  '8': [852, 1336],
  '9': [852, 1477],
  C: [852, 1633],
  '*': [941, 1209],
  '0': [941, 1336],
  '#': [941, 1477],
  D: [941, 1633],
};

function getSharedAudioContext(): AudioContext | null {
  try {
    if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
      sharedAudioContext = new AudioContext();
    }
    return sharedAudioContext;
  } catch {
    // catch-no-log-ok: AudioContext unavailable in test/headless environments
    return null;
  }
}

function clearOutgoingConnectToneSequenceTimers(): void {
  if (dialPhaseTimer != null) {
    clearTimeout(dialPhaseTimer);
    dialPhaseTimer = null;
  }
  if (dtmfToModemTimer != null) {
    clearTimeout(dtmfToModemTimer);
    dtmfToModemTimer = null;
  }
  connectSequenceActive = false;
  connectSequenceHash = null;
}

/** True while dial→DTMF→modem owns the timeline (before ringback starts). */
export function isOutgoingConnectToneSequenceActive(): boolean {
  return connectSequenceActive;
}

/** @internal Test helper — reset singleton between tests. */
export function resetVoiceCallTonesForTests(): void {
  stopVoiceCallTones();
  sharedAudioContext = null;
}

function isNotifMuted(): boolean {
  try {
    return localStorage.getItem(CHAT_NOTIF_MUTED_STORAGE_KEY) === '1';
  } catch {
    // catch-no-log-ok: localStorage may throw in private/restricted contexts
    return false;
  }
}

function playTonePulse(ctx: AudioContext, freq: number, dur: number, startTime: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.25, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
  osc.start(startTime);
  osc.stop(startTime + dur);
}

function withRunningContext(run: (ctx: AudioContext) => void): void {
  if (isNotifMuted()) return;
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  const go = () => {
    try {
      run(ctx);
    } catch {
      // catch-no-log-ok: AudioContext unavailable in test/headless environments
    }
  };
  if (ctx.state === 'suspended') {
    void ctx
      .resume()
      .then(go)
      .catch(() => {
        // catch-no-log-ok: resume blocked without user gesture in some environments
      });
    return;
  }
  go();
}

function stopDialToneNodes(): void {
  for (const osc of dialOscillators) {
    try {
      osc.stop();
    } catch {
      // catch-no-log-ok already stopped
    }
    try {
      osc.disconnect();
    } catch {
      // catch-no-log-ok
    }
  }
  dialOscillators = [];
  if (dialGain) {
    try {
      dialGain.disconnect();
    } catch {
      // catch-no-log-ok
    }
    dialGain = null;
  }
}

function stopRingbackInterval(): void {
  if (ringbackTimer != null) {
    clearInterval(ringbackTimer);
    ringbackTimer = null;
  }
}

function stopModemConnectingSoundscape(): void {
  if (modemCarrierStartTimer != null) {
    clearTimeout(modemCarrierStartTimer);
    modemCarrierStartTimer = null;
  }
  if (modemHeartbeatTimer != null) {
    clearInterval(modemHeartbeatTimer);
    modemHeartbeatTimer = null;
  }
  for (const node of modemStoppables) {
    try {
      node.stop();
    } catch {
      // catch-no-log-ok already stopped
    }
    try {
      node.disconnect();
    } catch {
      // catch-no-log-ok
    }
  }
  modemStoppables = [];
  for (const node of modemDisconnectables) {
    try {
      node.disconnect();
    } catch {
      // catch-no-log-ok
    }
  }
  modemDisconnectables = [];
}

function trackModemStoppable(node: {
  stop: (when?: number) => void;
  disconnect: () => void;
}): void {
  modemStoppables.push(node);
}

function trackModemDisconnectable(node: { disconnect: () => void }): void {
  modemDisconnectables.push(node);
}

function untrackModemStoppable(node: {
  stop: (when?: number) => void;
  disconnect: () => void;
}): void {
  modemStoppables = modemStoppables.filter((n) => n !== node);
}

function untrackModemDisconnectable(node: { disconnect: () => void }): void {
  modemDisconnectables = modemDisconnectables.filter((n) => n !== node);
}

/** Map peer identity/destination hash → 4 DTMF keys (stable per peer). */
export function dtmfKeysFromPeerHash(hash: string): string {
  // Full 32-hex fold — prefix-only made many peers sound identical.
  const hex = hash
    .replace(/[^0-9a-f]/gi, '')
    .toLowerCase()
    .padEnd(32, '0')
    .slice(0, 32);
  let out = '';
  for (let chunk = 0; chunk < 4; chunk += 1) {
    let n = 0;
    const base = chunk * 8;
    for (let j = 0; j < 8; j += 1) {
      n ^= parseInt(hex.charAt(base + j), 16);
    }
    out += DTMF_KEY_BY_NYBBLE[n & 0xf] ?? '0';
  }
  return out;
}

function playDtmfBurst(keys: string): void {
  withRunningContext((ctx) => {
    const now = ctx.currentTime;
    const period = DTMF_ON_S + DTMF_GAP_S;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys.charAt(i);
      if (!(key in DTMF_FREQS)) continue;
      const freqs = DTMF_FREQS[key];
      const t = now + i * period;
      playTonePulse(ctx, freqs[0], DTMF_ON_S, t);
      playTonePulse(ctx, freqs[1], DTMF_ON_S, t);
    }
  });
}

/** UK double-ring: 0.4s on, 0.2s off, 0.4s on, 2.0s silence (3.0s cycle); 400+450 Hz. */
const UK_RING_ON_S = 0.4;
const UK_RING_GAP_S = 0.2;
const UK_RINGBACK_INTERVAL_MS = 3000;

function scheduleRingbackBurst(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const second = now + UK_RING_ON_S + UK_RING_GAP_S;
  for (const freq of [400, 450]) {
    playTonePulse(ctx, freq, UK_RING_ON_S, now);
    playTonePulse(ctx, freq, UK_RING_ON_S, second);
  }
}

function scheduleModemChirp(
  ctx: AudioContext,
  startTime: number,
  durationS: number,
  gainLevel: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(1200, startTime);
  osc.frequency.linearRampToValueAtTime(2400, startTime + durationS);
  gain.gain.setValueAtTime(gainLevel, startTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationS);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + durationS);
  trackModemStoppable(osc);
  trackModemDisconnectable(gain);
  osc.onended = () => {
    untrackModemStoppable(osc);
    untrackModemDisconnectable(gain);
  };
}

function playModemHandshake(ctx: AudioContext): void {
  let t = ctx.currentTime;

  // V.25-style 2100 Hz answer tone
  const ansOsc = ctx.createOscillator();
  const ansGain = ctx.createGain();
  ansOsc.frequency.setValueAtTime(2100, t);
  ansGain.gain.setValueAtTime(0.1, t);
  ansGain.gain.exponentialRampToValueAtTime(0.0001, t + MODEM_ANSWER_S);
  ansOsc.connect(ansGain);
  ansGain.connect(ctx.destination);
  ansOsc.start(t);
  ansOsc.stop(t + MODEM_ANSWER_S);
  trackModemStoppable(ansOsc);
  trackModemDisconnectable(ansGain);
  t += MODEM_ANSWER_S;

  // Sweeping chirp
  scheduleModemChirp(ctx, t, MODEM_CHIRP_S, 0.06);
  t += MODEM_CHIRP_S;

  // Brief bandpass training noise
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * MODEM_TRAIN_S));
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.setValueAtTime(1800, t);
  bandpass.Q.setValueAtTime(2.5, t);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.1, t);
  noiseGain.gain.setValueAtTime(0.1, t + MODEM_TRAIN_S - 0.05);
  noiseGain.gain.linearRampToValueAtTime(0.0001, t + MODEM_TRAIN_S);
  noise.connect(bandpass);
  bandpass.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(t);
  noise.stop(t + MODEM_TRAIN_S);
  trackModemStoppable(noise);
  trackModemDisconnectable(bandpass);
  trackModemDisconnectable(noiseGain);
}

function startModemCarrierBed(ctx: AudioContext): void {
  const now = ctx.currentTime;

  // Quiet continuous 1800 Hz carrier sine
  const carrierOsc = ctx.createOscillator();
  const carrierGain = ctx.createGain();
  carrierOsc.frequency.setValueAtTime(1800, now);
  carrierGain.gain.setValueAtTime(0.035, now);
  carrierOsc.connect(carrierGain);
  carrierGain.connect(ctx.destination);
  carrierOsc.start(now);
  trackModemStoppable(carrierOsc);
  trackModemDisconnectable(carrierGain);

  // Soft looping bandpass noise bed
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * 1.0));
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = true;
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.setValueAtTime(1800, now);
  bandpass.Q.setValueAtTime(1.8, now);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.045, now);
  noise.connect(bandpass);
  bandpass.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(now);
  trackModemStoppable(noise);
  trackModemDisconnectable(bandpass);
  trackModemDisconnectable(noiseGain);
}

function playModemHeartbeatChirp(): void {
  if (!connectSequenceActive) return;
  withRunningContext((ctx) => {
    scheduleModemChirp(ctx, ctx.currentTime, MODEM_HEARTBEAT_CHIRP_S, 0.04);
  });
}

/**
 * One-shot modem handshake, then quiet continuous carrier until connect/fail.
 * Idempotent while already in the soundscape (caller gates via sequence timers).
 */
function startModemConnectingSoundscape(): void {
  if (isNotifMuted()) return;
  stopModemConnectingSoundscape();
  withRunningContext((ctx) => {
    playModemHandshake(ctx);
  });
  modemCarrierStartTimer = setTimeout(() => {
    modemCarrierStartTimer = null;
    if (!connectSequenceActive) return;
    withRunningContext((ctx) => {
      startModemCarrierBed(ctx);
    });
    if (modemHeartbeatTimer != null) {
      clearInterval(modemHeartbeatTimer);
    }
    modemHeartbeatTimer = setInterval(() => {
      playModemHeartbeatChirp();
    }, MODEM_HEARTBEAT_MS);
  }, MODEM_HANDSHAKE_MS);
}

/** Continuous US dial tone (350+440 Hz) while connecting. Idempotent. */
export function startVoiceDialTone(): void {
  if (isNotifMuted()) return;
  if (dialOscillators.length > 0) return;
  // Stop ringback cadence; keep dial nodes separate from pulse timers.
  stopRingbackInterval();
  withRunningContext((ctx) => {
    if (dialOscillators.length > 0) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.connect(ctx.destination);
    dialGain = gain;
    for (const freq of [350, 440]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start();
      dialOscillators.push(osc);
    }
  });
}

/** Start looping UK double-ring ringback while link is up / ringing. Idempotent. */
export function startVoiceRingback(): void {
  if (isNotifMuted()) return;
  stopDialToneNodes();
  stopModemConnectingSoundscape();
  if (ringbackTimer != null) return;
  withRunningContext((ctx) => {
    scheduleRingbackBurst(ctx);
  });
  ringbackTimer = setInterval(() => {
    withRunningContext((ctx) => {
      scheduleRingbackBurst(ctx);
    });
  }, UK_RINGBACK_INTERVAL_MS);
}

/**
 * Outbound connect cadence: dial 2s → rapid 4-digit peer DTMF → modem handshake → carrier.
 * Idempotent for the same peer hash while the dial/DTMF/modem phase is active.
 */
export function startOutgoingConnectToneSequence(peerHash: string): void {
  const hash = peerHash.replace(/[^0-9a-f]/gi, '').toLowerCase() || '0000';
  if (connectSequenceActive && connectSequenceHash === hash) return;

  clearOutgoingConnectToneSequenceTimers();
  stopModemConnectingSoundscape();
  stopDialToneNodes();
  stopRingbackInterval();

  connectSequenceActive = true;
  connectSequenceHash = hash;

  startVoiceDialTone();
  dialPhaseTimer = setTimeout(() => {
    dialPhaseTimer = null;
    if (!connectSequenceActive) return;
    stopDialToneNodes();
    playDtmfBurst(dtmfKeysFromPeerHash(hash));
    dtmfToModemTimer = setTimeout(() => {
      dtmfToModemTimer = null;
      if (!connectSequenceActive) return;
      startModemConnectingSoundscape();
    }, DTMF_BURST_MS + DTMF_TO_RING_GAP_MS);
  }, OUTGOING_DIAL_MS);
}

/**
 * End dial/DTMF/modem ownership and start UK ringback immediately (on connect).
 */
export function promoteOutgoingConnectSequenceToRingback(): void {
  clearOutgoingConnectToneSequenceTimers();
  stopModemConnectingSoundscape();
  stopDialToneNodes();
  startVoiceRingback();
}

/** Stop dial / ringback / cancel pending connect sequence — leaves one-shot busy/fail alone. */
export function stopVoiceProgressTones(): void {
  clearOutgoingConnectToneSequenceTimers();
  stopModemConnectingSoundscape();
  stopDialToneNodes();
  stopRingbackInterval();
}

/** Stop dial / ringback / cancel pending busy cadence marker. */
export function stopVoiceCallTones(): void {
  stopVoiceProgressTones();
  if (busyStopTimer != null) {
    clearTimeout(busyStopTimer);
    busyStopTimer = null;
  }
}

const BUSY_DUAL_HZ = [480, 620] as const;
/** Cap one-shot reorder / busy playback (wall clock). */
const TERMINAL_TONE_MAX_MS = 1500;

function playDualBusyPulse(ctx: AudioContext, onDurS: number, startTime: number): void {
  for (const freq of BUSY_DUAL_HZ) {
    playTonePulse(ctx, freq, onDurS, startTime);
  }
}

function scheduleCadencePulses(
  ctx: AudioContext,
  onDurS: number,
  periodS: number,
  pulseCount: number,
): void {
  const now = ctx.currentTime;
  for (let i = 0; i < pulseCount; i += 1) {
    playDualBusyPulse(ctx, onDurS, now + i * periodS);
  }
}

/**
 * Reorder / fast busy: 480+620 Hz, 0.25s on / 0.25s off (≤1.5s → 3 pulses).
 * Used for connect-fail and unexpected drop.
 */
function playVoiceDualCadence(opts: {
  onDurationS: number;
  periodS: number;
  pulseCount: number;
}): void {
  stopVoiceCallTones();
  if (isNotifMuted()) return;
  withRunningContext((ctx) => {
    scheduleCadencePulses(ctx, opts.onDurationS, opts.periodS, opts.pulseCount);
  });
  busyStopTimer = setTimeout(() => {
    busyStopTimer = null;
  }, TERMINAL_TONE_MAX_MS);
}

export function playVoiceReorderTone(): void {
  playVoiceDualCadence({ onDurationS: 0.25, periodS: 0.5, pulseCount: 3 });
}

/**
 * Standard busy: 480+620 Hz, 0.5s on / 0.5s off (≤1.5s → 2 pulses).
 * Used for line-busy and no-answer.
 */
export function playVoiceBusyTone(): void {
  playVoiceDualCadence({ onDurationS: 0.5, periodS: 1.0, pulseCount: 2 });
}

/** Distinct short down-tone for reject only. */
export function playVoiceFailTone(): void {
  stopVoiceCallTones();
  if (isNotifMuted()) return;
  withRunningContext((ctx) => {
    const now = ctx.currentTime;
    playTonePulse(ctx, 480, 0.2, now);
    playTonePulse(ctx, 360, 0.35, now + 0.22);
  });
}
