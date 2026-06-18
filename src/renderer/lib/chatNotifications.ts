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

export type ChatNotificationType = 'channel' | 'dm' | 'reply';

type SoundProfile =
  | { kind: 'single'; freq: number; dur: number }
  | { kind: 'dual'; pulse1Freq: number; pulse2Freq: number; dur: number; gap: number };

const SOUND_PROFILES: Record<ChatNotificationType, SoundProfile> = {
  channel: { kind: 'single', freq: 880, dur: 0.15 },
  dm: { kind: 'dual', pulse1Freq: 587.33, pulse2Freq: 783.99, dur: 0.05, gap: 0.035 },
  reply: { kind: 'dual', pulse1Freq: 587.33, pulse2Freq: 783.99, dur: 0.05, gap: 0.035 },
};

function playTonePulse(ctx: AudioContext, freq: number, dur: number, startTime: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.3, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
  osc.start(startTime);
  osc.stop(startTime + dur);
}

function scheduleMessageNotification(ctx: AudioContext, type: ChatNotificationType): void {
  const profile = SOUND_PROFILES[type];
  const now = ctx.currentTime;
  if (profile.kind === 'single') {
    playTonePulse(ctx, profile.freq, profile.dur, now);
    return;
  }
  playTonePulse(ctx, profile.pulse1Freq, profile.dur, now);
  playTonePulse(ctx, profile.pulse2Freq, profile.dur, now + profile.dur + profile.gap);
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
