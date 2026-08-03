/**
 * LXST call progress tones (ringback / busy / fail) via Web Audio.
 * Honors global chat notification mute (`mesh-client:notifMuted`).
 */

import { CHAT_NOTIF_MUTED_STORAGE_KEY } from '@/renderer/lib/chatInactiveNotifications';

let sharedAudioContext: AudioContext | null = null;
let ringbackTimer: ReturnType<typeof setInterval> | null = null;
let busyStopTimer: ReturnType<typeof setTimeout> | null = null;

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

function scheduleRingbackBurst(ctx: AudioContext): void {
  // US-style ringback: 440+480 Hz dual tone ~2s on, ~4s off (burst only; interval handles off).
  const now = ctx.currentTime;
  const dur = 2;
  playTonePulse(ctx, 440, dur, now);
  playTonePulse(ctx, 480, dur, now);
}

/** Start looping ringback while calling/ringing. Idempotent. */
export function startVoiceRingback(): void {
  if (isNotifMuted()) return;
  if (ringbackTimer != null) return;
  withRunningContext((ctx) => {
    scheduleRingbackBurst(ctx);
  });
  ringbackTimer = setInterval(() => {
    withRunningContext((ctx) => {
      scheduleRingbackBurst(ctx);
    });
  }, 6000);
}

/** Stop ringback / cancel pending busy cadence. */
export function stopVoiceCallTones(): void {
  if (ringbackTimer != null) {
    clearInterval(ringbackTimer);
    ringbackTimer = null;
  }
  if (busyStopTimer != null) {
    clearTimeout(busyStopTimer);
    busyStopTimer = null;
  }
}

/** Short repeating busy cadence (~0.5s on/off), then stop. */
export function playVoiceBusyTone(): void {
  stopVoiceCallTones();
  if (isNotifMuted()) return;
  withRunningContext((ctx) => {
    const now = ctx.currentTime;
    for (let i = 0; i < 6; i += 1) {
      const t = now + i;
      playTonePulse(ctx, 480, 0.45, t);
    }
  });
  busyStopTimer = setTimeout(() => {
    busyStopTimer = null;
  }, 6500);
}

/** Distinct short down-tone for no-answer / reject / generic fail. */
export function playVoiceFailTone(): void {
  stopVoiceCallTones();
  if (isNotifMuted()) return;
  withRunningContext((ctx) => {
    const now = ctx.currentTime;
    playTonePulse(ctx, 480, 0.2, now);
    playTonePulse(ctx, 360, 0.35, now + 0.22);
  });
}
