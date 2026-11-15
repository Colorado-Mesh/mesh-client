import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAT_NOTIF_MUTED_STORAGE_KEY } from '@/renderer/lib/chatInactiveNotifications';
import type { LiveTrafficSegment } from '@/renderer/lib/map/liveTrafficModel';

import {
  frequencyForHopDistanceKm,
  frequencyForHopSegment,
  HOP_TONE_FUNDAMENTAL_HZ,
  HOP_TONE_HARMONIC_NS,
  HOP_TONE_MAX_DISTANCE_KM,
  HOP_TONE_MAX_FREQ_HZ,
  HOP_TONE_MIN_DISTANCE_KM,
  HOP_TONE_MIN_FREQ_HZ,
  hopDistanceKm,
  hopToneHarmonicFrequenciesHz,
  LIVE_TRAFFIC_HOP_TONES_STORAGE_KEY,
  MAX_CONCURRENT_TONES,
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

  it('exposes a single harmonic series of integer multiples of the fundamental', () => {
    const freqs = hopToneHarmonicFrequenciesHz();
    expect(freqs).toEqual(HOP_TONE_HARMONIC_NS.map((n) => HOP_TONE_FUNDAMENTAL_HZ * n));
    expect(freqs[0]).toBe(HOP_TONE_MIN_FREQ_HZ);
    expect(freqs.at(-1)).toBe(HOP_TONE_MAX_FREQ_HZ);
    for (const freq of freqs) {
      expect(freq % HOP_TONE_FUNDAMENTAL_HZ).toBe(0);
    }
  });

  it('maps shorter hops to higher harmonics and longer hops to lower harmonics', () => {
    const short = frequencyForHopDistanceKm(HOP_TONE_MIN_DISTANCE_KM)!;
    const mid = frequencyForHopDistanceKm(20)!;
    const long = frequencyForHopDistanceKm(HOP_TONE_MAX_DISTANCE_KM)!;
    expect(short).toBe(HOP_TONE_MAX_FREQ_HZ);
    expect(long).toBe(HOP_TONE_MIN_FREQ_HZ);
    expect(short).toBeGreaterThanOrEqual(mid);
    expect(mid).toBeGreaterThanOrEqual(long);
    for (const freq of [short, mid, long]) {
      expect(hopToneHarmonicFrequenciesHz()).toContain(freq);
    }
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
    expect(frequencyForHopSegment(near)!).toBeGreaterThanOrEqual(frequencyForHopSegment(far)!);
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

  it('schedules a harmonic pair (root + octave) for the requested hop duration', () => {
    const oscillators: {
      frequency: { value: number };
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
    }[] = [];
    const setValueAtTime = vi.fn();
    const exponentialRampToValueAtTime = vi.fn();
    const ctx = {
      state: 'running',
      currentTime: 1,
      destination: {},
      createOscillator: vi.fn(() => {
        const osc = {
          type: 'sine',
          frequency: { value: 0 },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null as (() => void) | null,
        };
        oscillators.push(osc);
        return osc;
      }),
      createGain: vi.fn(() => ({
        gain: { setValueAtTime, exponentialRampToValueAtTime },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
    };
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function MockAudioContext() {
        return ctx;
      }),
    );

    playLiveTrafficHopTone({ frequencyHz: 440, durationMs: 660 });
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
    expect(oscillators.map((osc) => osc.frequency.value)).toEqual([440, 880]);
    expect(oscillators[0]?.start).toHaveBeenCalledWith(1);
    expect(oscillators[0]?.stop.mock.calls[0]?.[0]).toBeCloseTo(1.66);
    expect(exponentialRampToValueAtTime).toHaveBeenCalled();
  });

  it('skips playback when mute flips on before a suspended context resumes', async () => {
    let resolveResume: (() => void) | undefined;
    const resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveResume = resolve;
        }),
    );
    const createOscillator = vi.fn(() => ({
      type: 'sine',
      frequency: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    }));
    const ctx = {
      state: 'suspended',
      resume,
      currentTime: 0,
      destination: {},
      createOscillator,
      createGain: vi.fn(() => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
    };
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function MockAudioContext() {
        return ctx;
      }),
    );

    playLiveTrafficHopTone({ frequencyHz: 440, durationMs: 100 });
    expect(resume).toHaveBeenCalledOnce();
    localStorage.setItem(CHAT_NOTIF_MUTED_STORAGE_KEY, '1');
    resolveResume?.();
    await Promise.resolve();
    expect(createOscillator).not.toHaveBeenCalled();
  });

  it('counts pending suspended resumes against the concurrent tone budget', async () => {
    const resumeResolvers: (() => void)[] = [];
    const resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resumeResolvers.push(resolve);
        }),
    );
    const createOscillator = vi.fn(() => ({
      type: 'sine',
      frequency: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    }));
    const ctx = {
      state: 'suspended',
      resume,
      currentTime: 0,
      destination: {},
      createOscillator,
      createGain: vi.fn(() => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
    };
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function MockAudioContext() {
        return ctx;
      }),
    );

    for (let i = 0; i < MAX_CONCURRENT_TONES + 3; i += 1) {
      playLiveTrafficHopTone({ frequencyHz: 220 + i, durationMs: 100 });
    }
    expect(resume).toHaveBeenCalledTimes(MAX_CONCURRENT_TONES);

    for (const resolve of resumeResolvers) resolve();
    await Promise.resolve();
    // Two partials per admitted tone.
    expect(createOscillator).toHaveBeenCalledTimes(MAX_CONCURRENT_TONES * 2);
  });
});
