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

/** Outbound connect sequence: 2s dial → DTMF → ringback. */
let connectSequenceActive = false;
let connectSequenceHash: string | null = null;
let dialPhaseTimer: ReturnType<typeof setTimeout> | null = null;
let dtmfToRingTimer: ReturnType<typeof setTimeout> | null = null;

const OUTGOING_DIAL_MS = 2000;
const DTMF_ON_S = 0.12;
const DTMF_GAP_S = 0.06;
/** 4 × on + 3 × gap (last gap omitted) = 660ms. */
export const DTMF_BURST_MS = Math.round(4 * DTMF_ON_S * 1000 + 3 * DTMF_GAP_S * 1000);
/** Silence after last DTMF digit before UK ringback. */
export const DTMF_TO_RING_GAP_MS = 250;

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
  if (dtmfToRingTimer != null) {
    clearTimeout(dtmfToRingTimer);
    dtmfToRingTimer = null;
  }
  connectSequenceActive = false;
  connectSequenceHash = null;
}

/** True while dial→DTMF phase owns the timeline (before ringback starts). */
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
 * Outbound connect cadence: dial 2s → rapid 4-digit peer DTMF → UK ringback.
 * Idempotent for the same peer hash while the dial/DTMF phase is active.
 */
export function startOutgoingConnectToneSequence(peerHash: string): void {
  const hash = peerHash.replace(/[^0-9a-f]/gi, '').toLowerCase() || '0000';
  if (connectSequenceActive && connectSequenceHash === hash) return;

  clearOutgoingConnectToneSequenceTimers();
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
    dtmfToRingTimer = setTimeout(() => {
      dtmfToRingTimer = null;
      if (!connectSequenceActive) return;
      connectSequenceActive = false;
      connectSequenceHash = null;
      startVoiceRingback();
    }, DTMF_BURST_MS + DTMF_TO_RING_GAP_MS);
  }, OUTGOING_DIAL_MS);
}

/** Stop dial / ringback / cancel pending connect sequence — leaves one-shot busy/fail alone. */
export function stopVoiceProgressTones(): void {
  clearOutgoingConnectToneSequenceTimers();
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
export function playVoiceReorderTone(): void {
  stopVoiceCallTones();
  if (isNotifMuted()) return;
  withRunningContext((ctx) => {
    scheduleCadencePulses(ctx, 0.25, 0.5, 3);
  });
  busyStopTimer = setTimeout(() => {
    busyStopTimer = null;
  }, TERMINAL_TONE_MAX_MS);
}

/**
 * Standard busy: 480+620 Hz, 0.5s on / 0.5s off (≤1.5s → 2 pulses).
 * Used for line-busy and no-answer.
 */
export function playVoiceBusyTone(): void {
  stopVoiceCallTones();
  if (isNotifMuted()) return;
  withRunningContext((ctx) => {
    scheduleCadencePulses(ctx, 0.5, 1.0, 2);
  });
  busyStopTimer = setTimeout(() => {
    busyStopTimer = null;
  }, TERMINAL_TONE_MAX_MS);
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
