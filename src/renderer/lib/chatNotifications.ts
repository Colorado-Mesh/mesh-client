let sharedAudioContext: AudioContext | null = null;

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
export function resetChatNotificationAudioContextForTests(): void {
  sharedAudioContext = null;
}

export type ChatNotificationType =
  | 'channel'
  | 'dm'
  | 'reply'
  | 'mecp'
  | 'mecpSiren'
  /** US EAS-style attention signal (853+960 Hz) for MECP severity 1 URGENT. */
  | 'mecpEas';

type SoundProfile =
  | { kind: 'single'; freq: number; dur: number; gain?: number }
  | {
      kind: 'dual';
      pulse1Freq: number;
      pulse2Freq: number;
      dur: number;
      gap: number;
      gain?: number;
    }
  | {
      kind: 'triple';
      freqs: [number, number, number];
      dur: number;
      gap: number;
      gain?: number;
      /** Play the rising triple this many times (MECP 2–3 needs to cut through chat). */
      repeats?: number;
      repeatGap?: number;
    }
  | {
      kind: 'siren';
      lowFreq: number;
      highFreq: number;
      sweepMs: number;
      cycles: number;
      gain: number;
    }
  | {
      /** Simultaneous dual tones (US EAS attention signal: 853 Hz + 960 Hz). */
      kind: 'eas';
      freqs: [number, number];
      dur: number;
      gain: number;
    };

const SOUND_PROFILES: Record<ChatNotificationType, SoundProfile> = {
  channel: { kind: 'single', freq: 880, dur: 0.15 },
  dm: { kind: 'dual', pulse1Freq: 587.33, pulse2Freq: 783.99, dur: 0.05, gap: 0.035 },
  reply: { kind: 'dual', pulse1Freq: 587.33, pulse2Freq: 783.99, dur: 0.05, gap: 0.035 },
  mecp: {
    kind: 'triple',
    freqs: [784, 988, 1175],
    dur: 0.12,
    gap: 0.05,
    gain: 0.5,
    repeats: 2,
    repeatGap: 0.18,
  },
  mecpSiren: {
    kind: 'siren',
    lowFreq: 800,
    highFreq: 1200,
    sweepMs: 350,
    cycles: 4,
    gain: 0.55,
  },
  // FCC EAS attention signal frequencies; shortened from the full ~8s broadcast tone.
  mecpEas: { kind: 'eas', freqs: [853, 960], dur: 5, gain: 0.4 },
};

function playTonePulse(
  ctx: AudioContext,
  freq: number,
  dur: number,
  startTime: number,
  gainLevel = 0.3,
  type: OscillatorType = 'sine',
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(gainLevel, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
  osc.start(startTime);
  osc.stop(startTime + dur);
}

function scheduleSiren(ctx: AudioContext, profile: Extract<SoundProfile, { kind: 'siren' }>): void {
  const now = ctx.currentTime;
  const sweepSec = profile.sweepMs / 1000;
  for (let c = 0; c < profile.cycles; c++) {
    const t0 = now + c * sweepSec * 2;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(profile.lowFreq, t0);
    osc.frequency.linearRampToValueAtTime(profile.highFreq, t0 + sweepSec);
    osc.frequency.linearRampToValueAtTime(profile.lowFreq, t0 + sweepSec * 2);
    gain.gain.setValueAtTime(profile.gain, t0);
    gain.gain.setValueAtTime(profile.gain, t0 + sweepSec * 2 - 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + sweepSec * 2);
    osc.start(t0);
    osc.stop(t0 + sweepSec * 2);
  }
}

function scheduleEas(ctx: AudioContext, profile: Extract<SoundProfile, { kind: 'eas' }>): void {
  const now = ctx.currentTime;
  const fadeSec = 0.08;
  // Two simultaneous carriers — the dissonant interval is the recognizable EAS signature.
  for (const freq of profile.freqs) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(profile.gain, now);
    gain.gain.setValueAtTime(profile.gain, now + Math.max(0, profile.dur - fadeSec));
    gain.gain.exponentialRampToValueAtTime(0.001, now + profile.dur);
    osc.start(now);
    osc.stop(now + profile.dur);
  }
}

function scheduleMessageNotification(ctx: AudioContext, type: ChatNotificationType): void {
  const profile = SOUND_PROFILES[type];
  const now = ctx.currentTime;
  if (profile.kind === 'single') {
    playTonePulse(ctx, profile.freq, profile.dur, now, profile.gain);
    return;
  }
  if (profile.kind === 'dual') {
    const g = profile.gain ?? 0.3;
    playTonePulse(ctx, profile.pulse1Freq, profile.dur, now, g);
    playTonePulse(ctx, profile.pulse2Freq, profile.dur, now + profile.dur + profile.gap, g);
    return;
  }
  if (profile.kind === 'triple') {
    const g = profile.gain ?? 0.3;
    const repeats = profile.repeats ?? 1;
    const repeatGap = profile.repeatGap ?? 0.15;
    let t = now;
    for (let r = 0; r < repeats; r++) {
      if (r > 0) t += repeatGap;
      for (const freq of profile.freqs) {
        playTonePulse(ctx, freq, profile.dur, t, g);
        t += profile.dur + profile.gap;
      }
    }
    return;
  }
  if (profile.kind === 'eas') {
    scheduleEas(ctx, profile);
    return;
  }
  scheduleSiren(ctx, profile);
}

export function playMessageNotification(type: ChatNotificationType = 'channel'): void {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  const run = () => {
    try {
      scheduleMessageNotification(ctx, type);
    } catch {
      // catch-no-log-ok: AudioContext unavailable in test/headless environments
    }
  };
  if (ctx.state === 'suspended') {
    void ctx
      .resume()
      .then(run)
      .catch(() => {
        // catch-no-log-ok: resume blocked without user gesture in some environments
      });
    return;
  }
  run();
}

/** Sweeping siren for MECP severity 0 (MAYDAY). */
export function playMecpSiren(): void {
  playMessageNotification('mecpSiren');
}

/** US EAS-style 853+960 Hz attention signal for MECP severity 1 (URGENT). */
export function playMecpEasAttention(): void {
  playMessageNotification('mecpEas');
}
