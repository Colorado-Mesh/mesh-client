/**
 * Optional Live traffic hop tones: pitch from geographic hop distance; length matches hop flight.
 * Pitches are quantized to one harmonic series so concurrent hops stay consonant.
 * Honors global chat notification mute (`mesh-client:notifMuted`).
 */

import { CHAT_NOTIF_MUTED_STORAGE_KEY } from '@/renderer/lib/chatInactiveNotifications';
import type { LiveTrafficSegment } from '@/renderer/lib/map/liveTrafficModel';
import { haversineDistanceKm } from '@/renderer/lib/nodeStatus';
import { MS_PER_SECOND } from '@/shared/timeConstants';

export const LIVE_TRAFFIC_HOP_TONES_STORAGE_KEY = 'mesh-client:liveTrafficHopTones';

/** Shortest hop distance that maps to the highest harmonic. */
export const HOP_TONE_MIN_DISTANCE_KM = 0.5;
/** Longest hop distance that maps to the lowest harmonic. */
export const HOP_TONE_MAX_DISTANCE_KM = 200;

/** Common fundamental so every hop pitch is an integer multiple (no inharmonic “whale” slides). */
export const HOP_TONE_FUNDAMENTAL_HZ = 110;

/**
 * Harmonic numbers (n × fundamental), low → high.
 * Short hops use higher harmonics; long hops use lower ones.
 */
export const HOP_TONE_HARMONIC_NS = [2, 3, 4, 5, 6, 8] as const;

export const HOP_TONE_MIN_FREQ_HZ = HOP_TONE_FUNDAMENTAL_HZ * HOP_TONE_HARMONIC_NS[0];
export const HOP_TONE_MAX_FREQ_HZ =
  HOP_TONE_FUNDAMENTAL_HZ * HOP_TONE_HARMONIC_NS[HOP_TONE_HARMONIC_NS.length - 1];

const HOP_TONE_GAIN = 0.2;
const HOP_TONE_OVERTONE_GAIN = 0.08;
const HOP_TONE_ATTACK_MS = 12;
const HOP_TONE_FADE_MS = 80;
/** Concurrent hop-tone budget (pending resume + playing voices). */
export const MAX_CONCURRENT_TONES = 8;

export interface LiveTrafficHopTone {
  frequencyHz: number;
  durationMs: number;
}

let sharedAudioContext: AudioContext | null = null;
let activeToneCount = 0;
const activeOscillators = new Set<OscillatorNode>();
/** Bumped on cancel/stop so pending resume and partial callbacks cannot affect newer plays. */
let hopTonePlayGeneration = 0;

function getSharedAudioContext(): AudioContext | null {
  try {
    if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
      sharedAudioContext = new AudioContext();
    }
    return sharedAudioContext;
  } catch (e: unknown) {
    console.debug('[renderer/lib/map/liveTrafficHopTones] catch:', e);

    return null;
  }
}

function isNotifMuted(): boolean {
  try {
    return localStorage.getItem(CHAT_NOTIF_MUTED_STORAGE_KEY) === '1';
  } catch (e: unknown) {
    console.debug('[renderer/lib/map/liveTrafficHopTones] catch:', e);

    return false;
  }
}

/** @internal Test helper — reset singleton between tests. */
export function resetLiveTrafficHopTonesForTests(): void {
  sharedAudioContext = null;
  activeToneCount = 0;
  activeOscillators.clear();
  hopTonePlayGeneration = 0;
}

/** Stop tones already scheduled (e.g. when Reduce motion is enabled). */
export function stopActiveLiveTrafficHopTones(): void {
  hopTonePlayGeneration += 1;
  for (const osc of activeOscillators) {
    try {
      osc.stop();
      osc.disconnect();
    } catch (e: unknown) {
      console.debug('[renderer/lib/map/liveTrafficHopTones] catch:', e);
    }
  }
  activeOscillators.clear();
  activeToneCount = 0;
}

export function readLiveTrafficHopTonesEnabled(): boolean {
  try {
    return localStorage.getItem(LIVE_TRAFFIC_HOP_TONES_STORAGE_KEY) === '1';
  } catch (e: unknown) {
    console.debug('[renderer/lib/map/liveTrafficHopTones] catch:', e);

    return false;
  }
}

export function setLiveTrafficHopTonesEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LIVE_TRAFFIC_HOP_TONES_STORAGE_KEY, enabled ? '1' : '0');
  } catch (e: unknown) {
    console.debug('[renderer/lib/map/liveTrafficHopTones] catch:', e);
  }
}

/** Resume audio during a user gesture so later hop admissions can play. */
export function warmLiveTrafficHopTones(): void {
  if (isNotifMuted()) return;
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch((e: unknown) => {
      console.debug('[renderer/lib/map/liveTrafficHopTones] catch:', e);
    });
  }
}

export function hopDistanceKm(segment: LiveTrafficSegment): number {
  return haversineDistanceKm(segment.from.lat, segment.from.lon, segment.to.lat, segment.to.lon);
}

/** Harmonic series pitches (integer multiples of {@link HOP_TONE_FUNDAMENTAL_HZ}), low → high. */
export function hopToneHarmonicFrequenciesHz(): readonly number[] {
  return HOP_TONE_HARMONIC_NS.map((n) => HOP_TONE_FUNDAMENTAL_HZ * n);
}

/**
 * Map geographic hop length to a harmonic-series pitch: shorter → higher, longer → lower.
 * Duration is supplied separately so it can match the animated hop flight.
 */
export function frequencyForHopDistanceKm(km: number): number | null {
  if (!Number.isFinite(km) || km < 0) return null;
  const clamped = Math.min(HOP_TONE_MAX_DISTANCE_KM, Math.max(HOP_TONE_MIN_DISTANCE_KM, km));
  const logMin = Math.log(HOP_TONE_MIN_DISTANCE_KM);
  const logMax = Math.log(HOP_TONE_MAX_DISTANCE_KM);
  const t = (Math.log(clamped) - logMin) / (logMax - logMin);
  // t=0 (short) → highest harmonic index; t=1 (long) → lowest.
  const freqs = hopToneHarmonicFrequenciesHz();
  const index = Math.max(0, Math.min(freqs.length - 1, Math.round((1 - t) * (freqs.length - 1))));
  return freqs[index] ?? HOP_TONE_MIN_FREQ_HZ;
}

export function frequencyForHopSegment(segment: LiveTrafficSegment): number | null {
  return frequencyForHopDistanceKm(hopDistanceKm(segment));
}

function schedulePartial(
  ctx: AudioContext,
  frequencyHz: number,
  gainLevel: number,
  durationSec: number,
  startTime: number,
  playGeneration: number,
  onEnded: () => void,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.connect(gain);
  gain.connect(ctx.destination);
  activeOscillators.add(osc);
  osc.frequency.value = frequencyHz;
  const attackSec = Math.min(HOP_TONE_ATTACK_MS / MS_PER_SECOND, durationSec / 4);
  const fadeSec = Math.min(HOP_TONE_FADE_MS / MS_PER_SECOND, durationSec / 2);
  const sustainEnd = startTime + Math.max(attackSec, durationSec - fadeSec);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(gainLevel, startTime + attackSec);
  gain.gain.setValueAtTime(gainLevel, sustainEnd);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);
  osc.onended = () => {
    activeOscillators.delete(osc);
    osc.disconnect();
    gain.disconnect();
    if (playGeneration === hopTonePlayGeneration) onEnded();
  };
  osc.start(startTime);
  osc.stop(startTime + durationSec);
}

/**
 * Schedule root + octave partials for one reserved voice.
 * Caller already incremented {@link activeToneCount}; this releases it when both partials end.
 */
function playTonePulse(
  ctx: AudioContext,
  frequencyHz: number,
  durationSec: number,
  startTime: number,
  playGeneration: number,
): void {
  let remainingPartials = 2;
  let released = false;
  const finishPartial = () => {
    if (playGeneration !== hopTonePlayGeneration || released) return;
    remainingPartials -= 1;
    if (remainingPartials <= 0) {
      released = true;
      activeToneCount = Math.max(0, activeToneCount - 1);
    }
  };
  schedulePartial(
    ctx,
    frequencyHz,
    HOP_TONE_GAIN,
    durationSec,
    startTime,
    playGeneration,
    finishPartial,
  );
  schedulePartial(
    ctx,
    frequencyHz * 2,
    HOP_TONE_OVERTONE_GAIN,
    durationSec,
    startTime,
    playGeneration,
    finishPartial,
  );
}

export function playLiveTrafficHopTone(tone: LiveTrafficHopTone): void {
  if (isNotifMuted()) return;
  if (activeToneCount >= MAX_CONCURRENT_TONES) return;
  if (
    !Number.isFinite(tone.frequencyHz) ||
    !Number.isFinite(tone.durationMs) ||
    tone.frequencyHz <= 0 ||
    tone.durationMs <= 0
  ) {
    return;
  }
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  const durationSec = Math.max(tone.durationMs, HOP_TONE_FADE_MS * 2) / MS_PER_SECOND;
  const playGeneration = hopTonePlayGeneration;
  activeToneCount += 1;
  const releaseReservation = () => {
    if (playGeneration !== hopTonePlayGeneration) return;
    activeToneCount = Math.max(0, activeToneCount - 1);
  };
  const go = () => {
    if (playGeneration !== hopTonePlayGeneration) {
      releaseReservation();
      return;
    }
    if (isNotifMuted()) {
      releaseReservation();
      return;
    }
    try {
      playTonePulse(ctx, tone.frequencyHz, durationSec, ctx.currentTime, playGeneration);
    } catch (e: unknown) {
      console.debug('[renderer/lib/map/liveTrafficHopTones] catch:', e);

      releaseReservation();
    }
  };
  if (ctx.state === 'suspended') {
    void ctx
      .resume()
      .then(go)
      .catch((e: unknown) => {
        console.debug('[renderer/lib/map/liveTrafficHopTones] catch:', e);
        releaseReservation();
      });
    return;
  }
  go();
}
