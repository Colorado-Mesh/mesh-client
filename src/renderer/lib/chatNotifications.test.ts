import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  playMessageNotification,
  profileDurationSec,
  resetChatNotificationAudioContextForTests,
} from './chatNotifications';

describe('playMessageNotification', () => {
  let constructCount = 0;
  let oscillatorCount = 0;
  const oscillatorFrequencies: number[] = [];
  const oscillatorTypes: OscillatorType[] = [];
  const oscillatorStarts: number[] = [];
  const oscillatorStops: number[] = [];
  let mockState: AudioContextState = 'running';
  let resumeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    constructCount = 0;
    oscillatorCount = 0;
    oscillatorFrequencies.length = 0;
    oscillatorTypes.length = 0;
    oscillatorStarts.length = 0;
    oscillatorStops.length = 0;
    mockState = 'running';
    resumeMock = vi.fn(() => {
      mockState = 'running';
      return Promise.resolve();
    });
    resetChatNotificationAudioContextForTests();
    class MockAudioContext {
      destination = {};
      currentTime = 0;
      get state() {
        return mockState;
      }
      resume = resumeMock;
      createOscillator() {
        oscillatorCount += 1;
        const frequency = { value: 0 };
        oscillatorFrequencies.push(0);
        oscillatorTypes.push('sine');
        const idx = oscillatorCount - 1;
        return {
          get type() {
            return oscillatorTypes[idx] ?? 'sine';
          },
          set type(v: OscillatorType) {
            oscillatorTypes[idx] = v;
          },
          connect: vi.fn(),
          disconnect: vi.fn(),
          frequency: {
            set value(v: number) {
              frequency.value = v;
              oscillatorFrequencies[idx] = v;
            },
            get value() {
              return frequency.value;
            },
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
          },
          start: vi.fn((t: number) => {
            oscillatorStarts[idx] = t;
          }),
          stop: vi.fn((t: number) => {
            oscillatorStops[idx] = t;
          }),
        };
      }
      createGain() {
        return {
          connect: vi.fn(),
          disconnect: vi.fn(),
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
        };
      }
      constructor() {
        constructCount += 1;
      }
    }
    vi.stubGlobal('AudioContext', MockAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetChatNotificationAudioContextForTests();
  });

  async function expectOscillators(count: number, frequencies?: number[]): Promise<void> {
    await vi.waitFor(() => {
      expect(oscillatorCount).toBe(count);
    });
    if (frequencies) expect(oscillatorFrequencies).toEqual(frequencies);
  }

  it('reuses a single AudioContext across consecutive notifications', async () => {
    playMessageNotification();
    await expectOscillators(1);
    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });
    playMessageNotification();
    await expectOscillators(2);
    expect(constructCount).toBe(1);
    expect(oscillatorStops.length).toBeGreaterThan(0);
  });

  it('does not schedule a superseded alert after resume completes', async () => {
    mockState = 'suspended';
    let resumeStallsLeft = 1;
    let releaseStalledResume!: () => void;
    resumeMock = vi.fn(() => {
      if (resumeStallsLeft > 0) {
        resumeStallsLeft -= 1;
        return new Promise<void>((resolve) => {
          releaseStalledResume = () => {
            mockState = 'running';
            resolve();
          };
        });
      }
      mockState = 'running';
      return Promise.resolve();
    });
    playMessageNotification('channel');
    playMessageNotification('dm');
    releaseStalledResume();
    await expectOscillators(2, [587.33, 783.99]);
  });

  it('plays a single 880 Hz pulse for channel notifications', async () => {
    playMessageNotification('channel');
    await expectOscillators(1, [880]);
  });

  it('plays dual pulses for dm notifications', async () => {
    playMessageNotification('dm');
    await expectOscillators(2, [587.33, 783.99]);
  });

  it('plays dual pulses for reply notifications', async () => {
    playMessageNotification('reply');
    await expectOscillators(2, [587.33, 783.99]);
  });

  it('plays a repeated rising burst for mecp notifications', async () => {
    playMessageNotification('mecp');
    await expectOscillators(6, [784, 988, 1175, 784, 988, 1175]);
  });

  it('plays six short–long square pairs for mecpSafety', async () => {
    playMessageNotification('mecpSafety');
    await expectOscillators(
      12,
      [1175, 1175, 1175, 1175, 1175, 1175, 1175, 1175, 1175, 1175, 1175, 1175],
    );
    expect(oscillatorTypes.every((t) => t === 'square')).toBe(true);
    expect((oscillatorStops[0] ?? NaN) - (oscillatorStarts[0] ?? NaN)).toBeCloseTo(0.08, 5);
    expect((oscillatorStops[1] ?? NaN) - (oscillatorStarts[1] ?? NaN)).toBeCloseTo(0.32, 5);
    expect((oscillatorStarts[1] ?? NaN) - (oscillatorStarts[0] ?? NaN)).toBeCloseTo(0.14, 5);
  });

  it('plays simultaneous 853+960 Hz EAS attention tones for mecpEas', async () => {
    playMessageNotification('mecpEas');
    await expectOscillators(2, [853, 960]);
  });

  it('plays a falling pair for connectionLost', async () => {
    playMessageNotification('connectionLost');
    await expectOscillators(2, [783.99, 523.25]);
  });

  it('plays a flat pair for batteryLow', async () => {
    playMessageNotification('batteryLow');
    await expectOscillators(2, [440, 440]);
  });

  it('plays a multi-cycle siren for mecpSiren at elevated gain', async () => {
    const gainLevels: number[] = [];
    class MockAudioContextWithGainCapture {
      destination = {};
      currentTime = 0;
      get state() {
        return 'running' as AudioContextState;
      }
      resume = vi.fn(() => Promise.resolve());
      createOscillator() {
        oscillatorCount += 1;
        const idx = oscillatorCount - 1;
        const frequency = {
          value: 0,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        };
        return {
          type: 'sine',
          connect: vi.fn(),
          frequency,
          start: vi.fn((t: number) => {
            oscillatorStarts[idx] = t;
          }),
          stop: vi.fn((t: number) => {
            oscillatorStops[idx] = t;
          }),
        };
      }
      createGain() {
        return {
          connect: vi.fn(),
          disconnect: vi.fn(),
          gain: {
            setValueAtTime: (v: number) => {
              gainLevels.push(v);
            },
            exponentialRampToValueAtTime: vi.fn(),
          },
        };
      }
    }
    resetChatNotificationAudioContextForTests();
    vi.stubGlobal('AudioContext', MockAudioContextWithGainCapture);
    oscillatorCount = 0;
    oscillatorStarts.length = 0;
    oscillatorStops.length = 0;
    playMessageNotification('mecpSiren');
    await expectOscillators(6);
    expect(gainLevels.some((g) => g >= 0.5)).toBe(true);
    expect((oscillatorStops[0] ?? NaN) - (oscillatorStarts[0] ?? NaN)).toBeCloseTo(0.834, 3);
    expect((oscillatorStarts[5] ?? NaN) - (oscillatorStarts[0] ?? NaN)).toBeCloseTo(5 * 0.834, 3);
  });

  it('defaults to channel profile when type is omitted', async () => {
    playMessageNotification();
    await expectOscillators(1, [880]);
  });

  it('resumes suspended AudioContext before scheduling tones', async () => {
    mockState = 'suspended';
    playMessageNotification('dm');
    expect(resumeMock).toHaveBeenCalledOnce();
    expect(oscillatorCount).toBe(0);
    await expectOscillators(2, [587.33, 783.99]);
  });

  it('binds the default sink once when setSinkId is available', async () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    class MockAudioContextWithSink {
      destination = {};
      currentTime = 0;
      setSinkId = setSinkId;
      get state() {
        return mockState;
      }
      resume = resumeMock;
      createOscillator() {
        oscillatorCount += 1;
        return {
          type: 'sine',
          connect: vi.fn(),
          frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
          start: vi.fn(),
          stop: vi.fn(),
        };
      }
      createGain() {
        return {
          connect: vi.fn(),
          disconnect: vi.fn(),
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        };
      }
    }
    resetChatNotificationAudioContextForTests();
    vi.stubGlobal('AudioContext', MockAudioContextWithSink);
    playMessageNotification('channel');
    await expectOscillators(1);
    playMessageNotification('channel');
    await expectOscillators(2);
    expect(setSinkId).toHaveBeenCalledOnce();
    expect(setSinkId).toHaveBeenCalledWith('');
  });

  it('does not schedule when resume leaves the context suspended', async () => {
    mockState = 'suspended';
    resumeMock.mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    playMessageNotification('channel');
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });
    expect(oscillatorCount).toBe(0);
    warn.mockRestore();
  });

  it('profileDurationSec matches the scheduled final stop for single- and multi-repeat triples', async () => {
    const single = {
      kind: 'triple' as const,
      freqs: [784, 988, 1175] as [number, number, number],
      dur: 0.12,
      gap: 0.06,
      repeats: 1,
    };
    playMessageNotification('diagnosticError');
    await expectOscillators(3);
    expect(profileDurationSec(single)).toBeCloseTo(Math.max(...oscillatorStops), 5);

    oscillatorCount = 0;
    oscillatorStarts.length = 0;
    oscillatorStops.length = 0;
    const repeated = {
      kind: 'triple' as const,
      freqs: [784, 988, 1175] as [number, number, number],
      dur: 0.12,
      gap: 0.05,
      repeats: 2,
      repeatGap: 0.18,
    };
    playMessageNotification('mecp');
    await expectOscillators(6);
    expect(profileDurationSec(repeated)).toBeCloseTo(Math.max(...oscillatorStops), 5);
  });
});

describe('profileDurationSec', () => {
  it('covers builtin profile shapes used for native offline rendering', () => {
    expect(profileDurationSec({ kind: 'single', freq: 880, dur: 0.15 })).toBeCloseTo(0.15);
    expect(
      profileDurationSec({
        kind: 'dual',
        pulse1Freq: 1,
        pulse2Freq: 2,
        dur: 0.05,
        gap: 0.035,
      }),
    ).toBeCloseTo(0.135);
    expect(
      profileDurationSec({
        kind: 'siren',
        lowFreq: 800,
        highFreq: 1200,
        sweepMs: 417,
        cycles: 6,
        gain: 0.55,
      }),
    ).toBeCloseTo(6 * 2 * 0.417);
  });
});
