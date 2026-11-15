/**
 * Optional Live traffic hop tones: pitch from geographic hop distance; length matches hop flight.
 * Honors global chat notification mute (`mesh-client:notifMuted`).
 */

import { CHAT_NOTIF_MUTED_STORAGE_KEY } from '@/renderer/lib/chatInactiveNotifications';
import type { LiveTrafficSegment } from '@/renderer/lib/map/liveTrafficModel';
import { haversineDistanceKm } from '@/renderer/lib/nodeStatus';
import { MS_PER_SECOND } from '@/shared/timeConstants';

export const LIVE_TRAFFIC_HOP_TONES_STORAGE_KEY = 'mesh-client:liveTrafficHopTones';

/** Shortest hop distance that maps to the highest pitch. */
export const HOP_TONE_MIN_DISTANCE_KM = 0.5;
/** Longest hop distance that maps to the lowest pitch. */
export const HOP_TONE_MAX_DISTANCE_KM = 200;

export const HOP_TONE_MAX_FREQ_HZ = 880;
export const HOP_TONE_MIN_FREQ_HZ = 150;

const HOP_TONE_GAIN = 0.28;
const HOP_TONE_FADE_MS = 60;
const MAX_CONCURRENT_TONES = 8;

export interface LiveTrafficHopTone {
  frequencyHz: number;
  durationMs: number;
}

let sharedAudioContext: AudioContext | null = null;
let activeToneCount = 0;

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

function isNotifMuted(): boolean {
  try {
    return localStorage.getItem(CHAT_NOTIF_MUTED_STORAGE_KEY) === '1';
  } catch {
    // catch-no-log-ok: localStorage may throw in private/restricted contexts
    return false;
  }
}

/** @internal Test helper — reset singleton between tests. */
export function resetLiveTrafficHopTonesForTests(): void {
  sharedAudioContext = null;
  activeToneCount = 0;
}

export function readLiveTrafficHopTonesEnabled(): boolean {
  try {
    return localStorage.getItem(LIVE_TRAFFIC_HOP_TONES_STORAGE_KEY) === '1';
  } catch {
    // catch-no-log-ok: localStorage may throw in private/restricted contexts
    return false;
  }
}

export function setLiveTrafficHopTonesEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LIVE_TRAFFIC_HOP_TONES_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // catch-no-log-ok: localStorage may throw in private/restricted contexts
  }
}

/** Resume audio during a user gesture so later hop admissions can play. */
export function warmLiveTrafficHopTones(): void {
  if (isNotifMuted()) return;
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {
      // catch-no-log-ok: resume blocked without user gesture in some environments
    });
  }
}

export function hopDistanceKm(segment: LiveTrafficSegment): number {
  return haversineDistanceKm(segment.from.lat, segment.from.lon, segment.to.lat, segment.to.lon);
}

/**
 * Map geographic hop length to pitch: shorter → higher, longer → lower.
 * Duration is supplied separately so it can match the animated hop flight.
 */
export function frequencyForHopDistanceKm(km: number): number | null {
  if (!Number.isFinite(km) || km < 0) return null;
  const clamped = Math.min(HOP_TONE_MAX_DISTANCE_KM, Math.max(HOP_TONE_MIN_DISTANCE_KM, km));
  const logMin = Math.log(HOP_TONE_MIN_DISTANCE_KM);
  const logMax = Math.log(HOP_TONE_MAX_DISTANCE_KM);
  const t = (Math.log(clamped) - logMin) / (logMax - logMin);
  return HOP_TONE_MAX_FREQ_HZ + (HOP_TONE_MIN_FREQ_HZ - HOP_TONE_MAX_FREQ_HZ) * t;
}

export function frequencyForHopSegment(segment: LiveTrafficSegment): number | null {
  return frequencyForHopDistanceKm(hopDistanceKm(segment));
}

function playTonePulse(
  ctx: AudioContext,
  frequencyHz: number,
  durationSec: number,
  startTime: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = frequencyHz;
  const fadeSec = Math.min(HOP_TONE_FADE_MS / MS_PER_SECOND, durationSec / 2);
  const sustainEnd = startTime + Math.max(0, durationSec - fadeSec);
  gain.gain.setValueAtTime(HOP_TONE_GAIN, startTime);
  gain.gain.setValueAtTime(HOP_TONE_GAIN, sustainEnd);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + durationSec);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
    activeToneCount = Math.max(0, activeToneCount - 1);
  };
  activeToneCount += 1;
  osc.start(startTime);
  osc.stop(startTime + durationSec);
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
  const go = () => {
    try {
      playTonePulse(ctx, tone.frequencyHz, durationSec, ctx.currentTime);
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
