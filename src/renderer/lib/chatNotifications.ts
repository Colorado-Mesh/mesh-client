import {
  MAX_NOTIFICATION_SOUND_BYTES,
  MAX_NOTIFICATION_SOUND_SECONDS,
} from '@/shared/notificationSounds';
import { MS_PER_MINUTE, MS_PER_SECOND } from '@/shared/timeConstants';

import {
  getNotificationSoundSettings,
  type NotificationSoundSetting,
} from './notificationSoundSettings';

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
  audioBuffers.clear();
  stopNotificationSoundPreview();
}

export type ChatNotificationType =
  | 'channel'
  | 'dm'
  | 'reply'
  | 'mecp'
  | 'mecpSafety'
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
      /** Short–long pairs with a pause between pairs (MECP SAFETY: dit–dah × N). */
      kind: 'shortLong';
      freq: number;
      shortDur: number;
      longDur: number;
      /** Gap between the short and long pulse within one pair. */
      pulseGap: number;
      /** Pause after each short–long pair (including after the last for envelope cleanup). */
      pairGap: number;
      repeats: number;
      gain?: number;
      /** Waveform; square cuts through ambient noise better than sine for SAFETY. */
      type?: OscillatorType;
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
  mecpSafety: {
    // dit–dah, pause × 6 (~4.4s — double the prior ×3 length); piercing square for urgency
    kind: 'shortLong',
    freq: 1175,
    shortDur: 0.08,
    longDur: 0.32,
    pulseGap: 0.06,
    pairGap: 0.28,
    repeats: 6,
    gain: 0.55,
    type: 'square',
  },
  mecpSiren: {
    kind: 'siren',
    lowFreq: 800,
    highFreq: 1200,
    // 6 cycles × 2 × 0.417s ≈ 5.0s — matches mecpEas (URGENT) length
    sweepMs: 417,
    cycles: 6,
    gain: 0.55,
  },
  // FCC EAS attention signal frequencies; shortened from the full ~8s broadcast tone.
  mecpEas: { kind: 'eas', freqs: [853, 960], dur: 5, gain: 0.4 },
};

const PRESET_PROFILES: Record<
  Exclude<NotificationSoundSetting['sound'], object | 'default'>,
  SoundProfile
> = {
  chime: { kind: 'dual', pulse1Freq: 659.25, pulse2Freq: 1046.5, dur: 0.3, gap: 0.06, gain: 0.45 },
  bell: { kind: 'single', freq: 1318.5, dur: 0.65, gain: 0.5 },
  ping: { kind: 'dual', pulse1Freq: 880, pulse2Freq: 880, dur: 0.18, gap: 0.12, gain: 0.45 },
  alert: { kind: 'triple', freqs: [784, 988, 1175], dur: 0.15, gap: 0.08, gain: 0.5, repeats: 2 },
};

interface Playback {
  output: GainNode;
  track: (source: AudioScheduledSourceNode, gain?: GainNode) => void;
  stop: () => void;
  finished: Promise<void>;
}

function createPlayback(ctx: AudioContext, volume: number): Playback {
  const output = ctx.createGain();
  output.gain.setValueAtTime(volume / 100, ctx.currentTime);
  output.connect(ctx.destination);
  const sources = new Set<AudioScheduledSourceNode>();
  let finish = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return {
    output,
    finished,
    track(source, gain) {
      sources.add(source);
      source.onended = () => {
        source.disconnect();
        gain?.disconnect();
        sources.delete(source);
        if (sources.size === 0) {
          output.disconnect();
          finish();
        }
      };
    },
    stop() {
      output.disconnect();
      for (const source of sources) source.stop();
      finish();
    },
  };
}

function playTonePulse(
  ctx: AudioContext,
  playback: Playback,
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
  gain.connect(playback.output);
  playback.track(osc, gain);
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(gainLevel, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
  osc.start(startTime);
  osc.stop(startTime + dur);
}

function scheduleSiren(
  ctx: AudioContext,
  playback: Playback,
  profile: Extract<SoundProfile, { kind: 'siren' }>,
): void {
  const now = ctx.currentTime;
  const sweepSec = profile.sweepMs / 1000;
  for (let c = 0; c < profile.cycles; c++) {
    const t0 = now + c * sweepSec * 2;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.connect(gain);
    gain.connect(playback.output);
    playback.track(osc, gain);
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

function scheduleEas(
  ctx: AudioContext,
  playback: Playback,
  profile: Extract<SoundProfile, { kind: 'eas' }>,
): void {
  const now = ctx.currentTime;
  const fadeSec = 0.08;
  // Two simultaneous carriers — the dissonant interval is the recognizable EAS signature.
  for (const freq of profile.freqs) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(playback.output);
    playback.track(osc, gain);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(profile.gain, now);
    gain.gain.setValueAtTime(profile.gain, now + Math.max(0, profile.dur - fadeSec));
    gain.gain.exponentialRampToValueAtTime(0.001, now + profile.dur);
    osc.start(now);
    osc.stop(now + profile.dur);
  }
}

function scheduleProfile(ctx: AudioContext, playback: Playback, profile: SoundProfile): void {
  const now = ctx.currentTime;
  if (profile.kind === 'single') {
    playTonePulse(ctx, playback, profile.freq, profile.dur, now, profile.gain);
    return;
  }
  if (profile.kind === 'dual') {
    const g = profile.gain ?? 0.3;
    playTonePulse(ctx, playback, profile.pulse1Freq, profile.dur, now, g);
    playTonePulse(
      ctx,
      playback,
      profile.pulse2Freq,
      profile.dur,
      now + profile.dur + profile.gap,
      g,
    );
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
        playTonePulse(ctx, playback, freq, profile.dur, t, g);
        t += profile.dur + profile.gap;
      }
    }
    return;
  }
  if (profile.kind === 'shortLong') {
    const g = profile.gain ?? 0.3;
    const type = profile.type ?? 'sine';
    let t = now;
    for (let r = 0; r < profile.repeats; r++) {
      playTonePulse(ctx, playback, profile.freq, profile.shortDur, t, g, type);
      t += profile.shortDur + profile.pulseGap;
      playTonePulse(ctx, playback, profile.freq, profile.longDur, t, g, type);
      t += profile.longDur + profile.pairGap;
    }
    return;
  }
  if (profile.kind === 'eas') {
    scheduleEas(ctx, playback, profile);
    return;
  }
  scheduleSiren(ctx, playback, profile);
}

const audioBuffers = new Map<
  ChatNotificationType,
  { id: string; buffer: Promise<AudioBuffer>; retryAt: number }
>();
let previewVersion = 0;
let previewPlayback: Playback | null = null;

export function clearNotificationSoundCache(event: ChatNotificationType): void {
  audioBuffers.delete(event);
}

async function validateSoundMetadata(bytes: ArrayBuffer): Promise<void> {
  const audio = new Audio();
  const url = URL.createObjectURL(new Blob([bytes]));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error('Audio metadata timed out'));
      }, 5 * MS_PER_SECOND);
      audio.onloadedmetadata = () => {
        if (
          !Number.isFinite(audio.duration) ||
          audio.duration <= 0 ||
          audio.duration > MAX_NOTIFICATION_SOUND_SECONDS
        ) {
          reject(new Error('Sound must be no longer than 10 seconds'));
        } else resolve();
      };
      audio.onerror = () => {
        reject(new Error('Unsupported audio metadata'));
      };
      audio.preload = 'metadata';
      audio.src = url;
    });
  } finally {
    clearTimeout(timeout);
    audio.onloadedmetadata = null;
    audio.onerror = null;
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(url);
  }
}

async function decodeSound(ctx: AudioContext, dataBase64: string): Promise<AudioBuffer> {
  if (!dataBase64 || dataBase64.length > Math.ceil(MAX_NOTIFICATION_SOUND_BYTES / 3) * 4) {
    throw new Error('Sound exceeds size limit');
  }
  const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
  if (bytes.length > MAX_NOTIFICATION_SOUND_BYTES) throw new Error('Sound exceeds size limit');
  // Probe duration without allocating a full PCM buffer for a long compressed recording.
  await validateSoundMetadata(bytes.buffer);
  const buffer = await ctx.decodeAudioData(bytes.buffer);
  if (
    !Number.isFinite(buffer.duration) ||
    buffer.duration <= 0 ||
    buffer.duration > MAX_NOTIFICATION_SOUND_SECONDS
  ) {
    throw new Error('Sound must be no longer than 10 seconds');
  }
  return buffer;
}

export async function validateNotificationSound(dataBase64: string): Promise<void> {
  const ctx = getSharedAudioContext();
  if (!ctx) throw new Error('Audio is unavailable');
  await decodeSound(ctx, dataBase64);
}

function loadCustomSound(
  ctx: AudioContext,
  event: ChatNotificationType,
  id: string,
): Promise<AudioBuffer> {
  const cached = audioBuffers.get(event);
  if (cached?.id === id && Date.now() < cached.retryAt) return cached.buffer;
  const buffer = window.electronAPI.notificationSounds.read(event, id).then((data) => {
    if (!data) throw new Error('Saved sound is unavailable');
    return decodeSound(ctx, data);
  });
  const entry = { id, buffer, retryAt: Infinity };
  audioBuffers.set(event, entry);
  void buffer.catch(() => {
    // catch-no-log-ok: callers handle fallback/errors; retry failures at most once per minute.
    entry.retryAt = Date.now() + MS_PER_MINUTE;
  });
  return buffer;
}

function scheduleSelected(
  ctx: AudioContext,
  event: ChatNotificationType,
  setting: NotificationSoundSetting,
  buffer?: AudioBuffer,
): Playback {
  const playback = createPlayback(ctx, setting.volume);
  if (buffer) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(playback.output);
    playback.track(source);
    source.start();
  } else {
    const profile =
      typeof setting.sound === 'string' && setting.sound !== 'default'
        ? PRESET_PROFILES[setting.sound]
        : SOUND_PROFILES[event];
    scheduleProfile(ctx, playback, profile);
  }
  return playback;
}

export function playMessageNotification(type: ChatNotificationType = 'channel'): void {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  const setting = getNotificationSoundSettings()[type];
  if (setting.volume === 0) return;
  const run = async () => {
    let buffer: AudioBuffer | undefined;
    if (typeof setting.sound === 'object') {
      try {
        buffer = await loadCustomSound(ctx, type, setting.sound.id);
      } catch {
        // catch-no-log-ok: a missing/invalid saved sound falls back to the event's built-in tone.
      }
    }
    scheduleSelected(ctx, type, setting, buffer);
  };
  const play = () => {
    void run().catch((error: unknown) => {
      console.warn('[notificationSounds] playback failed', error);
    });
  };
  if (ctx.state === 'suspended') {
    void ctx
      .resume()
      .then(play)
      .catch((error: unknown) => {
        console.warn('[notificationSounds] resume failed', error);
      });
  } else play();
}

export function stopNotificationSoundPreview(): void {
  previewVersion++;
  previewPlayback?.stop();
  previewPlayback = null;
}

export async function previewNotificationSound(
  event: ChatNotificationType,
  setting: NotificationSoundSetting,
): Promise<void> {
  stopNotificationSoundPreview();
  const version = previewVersion;
  if (setting.volume === 0) return;
  const ctx = getSharedAudioContext();
  if (!ctx) throw new Error('Audio is unavailable');
  if (ctx.state === 'suspended') await ctx.resume();
  let buffer: AudioBuffer | undefined;
  if (typeof setting.sound === 'object') {
    const loading = loadCustomSound(ctx, event, setting.sound.id);
    try {
      buffer = await loading;
    } catch (error) {
      // An explicit retry should re-read; do not clear a newer import or preview's cache.
      if (audioBuffers.get(event)?.buffer === loading) clearNotificationSoundCache(event);
      throw error;
    }
  }
  if (version !== previewVersion) return;
  const playback = scheduleSelected(ctx, event, setting, buffer);
  previewPlayback = playback;
  await playback.finished;
  if (version === previewVersion) previewPlayback = null;
}

/** Sweeping siren for MECP severity 0 (MAYDAY). */
export function playMecpSiren(): void {
  playMessageNotification('mecpSiren');
}

/** US EAS-style 853+960 Hz attention signal for MECP severity 1 (URGENT). */
export function playMecpEasAttention(): void {
  playMessageNotification('mecpEas');
}
