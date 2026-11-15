import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAT_NOTIF_MUTED_STORAGE_KEY } from '@/renderer/lib/chatInactiveNotifications';
import type { LiveTrafficSegment } from '@/renderer/lib/map/liveTrafficModel';

import {
  frequencyForHopDistanceKm,
  frequencyForHopSegment,
  HOP_TONE_MAX_DISTANCE_KM,
  HOP_TONE_MAX_FREQ_HZ,
  HOP_TONE_MIN_DISTANCE_KM,
  HOP_TONE_MIN_FREQ_HZ,
  hopDistanceKm,
  LIVE_TRAFFIC_HOP_TONES_STORAGE_KEY,
  playLiveTrafficHopTone,
  readLiveTrafficHopTonesEnabled,
  resetLiveTrafficHopTonesForTests,
  setLiveTrafficHopTonesEnabled,
  warmLiveTrafficHopTones,
} from './liveTrafficHopTones';

function segment(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): LiveTrafficSegment {
  return {
    from: { nodeId: 1, lat: fromLat, lon: fromLon, label: 'A' },
    to: { nodeId: 2, lat: toLat, lon: toLon, label: 'B' },
  };
}

describe('liveTrafficHopTones', () => {
  beforeEach(() => {
    localStorage.clear();
    resetLiveTrafficHopTonesForTests();
  });

  afterEach(() => {
    resetLiveTrafficHopTonesForTests();
    vi.restoreAllMocks();
  });

  it('persists the hop-tones preference off by default', () => {
    expect(readLiveTrafficHopTonesEnabled()).toBe(false);
    setLiveTrafficHopTonesEnabled(true);
    expect(localStorage.getItem(LIVE_TRAFFIC_HOP_TONES_STORAGE_KEY)).toBe('1');
    expect(readLiveTrafficHopTonesEnabled()).toBe(true);
    setLiveTrafficHopTonesEnabled(false);
    expect(localStorage.getItem(LIVE_TRAFFIC_HOP_TONES_STORAGE_KEY)).toBe('0');
  });

  it('maps shorter hops to higher pitch and longer hops to lower pitch', () => {
    const short = frequencyForHopDistanceKm(HOP_TONE_MIN_DISTANCE_KM)!;
    const mid = frequencyForHopDistanceKm(20)!;
    const long = frequencyForHopDistanceKm(HOP_TONE_MAX_DISTANCE_KM)!;
    expect(short).toBeCloseTo(HOP_TONE_MAX_FREQ_HZ);
    expect(long).toBeCloseTo(HOP_TONE_MIN_FREQ_HZ);
    expect(short).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(long);
  });

  it('clamps distances outside the mapping range and rejects invalid input', () => {
    expect(frequencyForHopDistanceKm(0.01)).toEqual(
      frequencyForHopDistanceKm(HOP_TONE_MIN_DISTANCE_KM),
    );
    expect(frequencyForHopDistanceKm(10_000)).toEqual(
      frequencyForHopDistanceKm(HOP_TONE_MAX_DISTANCE_KM),
    );
    expect(frequencyForHopDistanceKm(Number.NaN)).toBeNull();
    expect(frequencyForHopDistanceKm(-1)).toBeNull();
  });

  it('derives pitch from segment geography', () => {
    const near = segment(39.7, -104.9, 39.71, -104.9);
    const far = segment(39.7, -104.9, 40.7, -104.9);
    expect(hopDistanceKm(near)).toBeLessThan(hopDistanceKm(far));
    expect(frequencyForHopSegment(near)!).toBeGreaterThan(frequencyForHopSegment(far)!);
  });

  it('does not play when globally muted or when AudioContext is unavailable', () => {
    localStorage.setItem(CHAT_NOTIF_MUTED_STORAGE_KEY, '1');
    const AudioContextSpy = vi.fn();
    vi.stubGlobal('AudioContext', AudioContextSpy);
    playLiveTrafficHopTone({ frequencyHz: 440, durationMs: 100 });
    expect(AudioContextSpy).not.toHaveBeenCalled();

    localStorage.removeItem(CHAT_NOTIF_MUTED_STORAGE_KEY);
    vi.stubGlobal('AudioContext', function BrokenAudioContext() {
      throw new Error('unavailable');
    });
    expect(() => {
      playLiveTrafficHopTone({ frequencyHz: 440, durationMs: 100 });
    }).not.toThrow();
  });

  it('warms a suspended AudioContext during the enable gesture', () => {
    const resume = vi.fn(() => Promise.resolve());
    const ctx = {
      state: 'suspended',
      resume,
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn(),
      createGain: vi.fn(),
    };
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function MockAudioContext() {
        return ctx;
      }),
    );
    warmLiveTrafficHopTones();
    expect(resume).toHaveBeenCalledOnce();
  });

  it('schedules a sustained sine for the requested hop duration', () => {
    const stop = vi.fn();
    const start = vi.fn();
    const disconnect = vi.fn();
    const setValueAtTime = vi.fn();
    const exponentialRampToValueAtTime = vi.fn();
    const osc = {
      type: 'sine',
      frequency: { value: 0 },
      connect: vi.fn(),
      disconnect,
      start,
      stop,
      onended: null as (() => void) | null,
    };
    const gain = {
      gain: { setValueAtTime, exponentialRampToValueAtTime },
      connect: vi.fn(),
      disconnect,
    };
    const ctx = {
      state: 'running',
      currentTime: 1,
      destination: {},
      createOscillator: vi.fn(() => osc),
      createGain: vi.fn(() => gain),
    };
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function MockAudioContext() {
        return ctx;
      }),
    );

    playLiveTrafficHopTone({ frequencyHz: 440, durationMs: 660 });
    expect(ctx.createOscillator).toHaveBeenCalledOnce();
    expect(osc.frequency.value).toBe(440);
    expect(osc.type).toBe('sine');
    expect(start).toHaveBeenCalledWith(1);
    expect(stop.mock.calls[0]?.[0]).toBeCloseTo(1.66);
    expect(setValueAtTime).toHaveBeenCalledWith(0.28, 1);
    expect(exponentialRampToValueAtTime).toHaveBeenCalled();
  });
});
