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

export type ChatNotificationType = 'channel' | 'dm' | 'reply' | 'mecp' | 'mecpSiren';

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
    }
  | {
      kind: 'siren';
      lowFreq: number;
      highFreq: number;
      sweepMs: number;
      cycles: number;
      gain: number;
    };

const SOUND_PROFILES: Record<ChatNotificationType, SoundProfile> = {
  channel: { kind: 'single', freq: 880, dur: 0.15 },
  dm: { kind: 'dual', pulse1Freq: 587.33, pulse2Freq: 783.99, dur: 0.05, gap: 0.035 },
  reply: { kind: 'dual', pulse1Freq: 587.33, pulse2Freq: 783.99, dur: 0.05, gap: 0.035 },
  mecp: { kind: 'triple', freqs: [659, 784, 988], dur: 0.07, gap: 0.04, gain: 0.35 },
  mecpSiren: {
    kind: 'siren',
    lowFreq: 800,
    highFreq: 1200,
    sweepMs: 350,
    cycles: 4,
    gain: 0.55,
  },
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
    let t = now;
    for (const freq of profile.freqs) {
      playTonePulse(ctx, freq, profile.dur, t, g);
      t += profile.dur + profile.gap;
    }
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

/** Loud unique siren for MECP severity 0–1. */
export function playMecpSiren(): void {
  playMessageNotification('mecpSiren');
}
