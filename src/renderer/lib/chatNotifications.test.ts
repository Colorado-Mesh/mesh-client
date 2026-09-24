import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  playMessageNotification,
  resetChatNotificationAudioContextForTests,
} from './chatNotifications';

describe('playMessageNotification', () => {
  let constructCount = 0;
  let oscillatorCount = 0;
  const oscillatorFrequencies: number[] = [];
  let mockState: AudioContextState = 'running';
  let resumeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    constructCount = 0;
    oscillatorCount = 0;
    oscillatorFrequencies.length = 0;
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
        return {
          connect: vi.fn(),
          frequency: {
            set value(v: number) {
              frequency.value = v;
              oscillatorFrequencies[oscillatorFrequencies.length - 1] = v;
            },
            get value() {
              return frequency.value;
            },
          },
          start: vi.fn(),
          stop: vi.fn(),
        };
      }
      createGain() {
        return {
          connect: vi.fn(),
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

  it('reuses a single AudioContext across consecutive notifications', () => {
    playMessageNotification();
    playMessageNotification();
    expect(constructCount).toBe(1);
  });

  it('plays a single 880 Hz pulse for channel notifications', () => {
    playMessageNotification('channel');
    expect(oscillatorCount).toBe(1);
    expect(oscillatorFrequencies).toEqual([880]);
  });

  it('plays dual pulses for dm notifications', () => {
    playMessageNotification('dm');
    expect(oscillatorCount).toBe(2);
    expect(oscillatorFrequencies).toEqual([587.33, 783.99]);
  });

  it('plays dual pulses for reply notifications', () => {
    playMessageNotification('reply');
    expect(oscillatorCount).toBe(2);
    expect(oscillatorFrequencies).toEqual([587.33, 783.99]);
  });

  it('plays a repeated rising burst for mecp notifications', () => {
    playMessageNotification('mecp');
    // 2 repeats × 3 pulses
    expect(oscillatorCount).toBe(6);
    expect(oscillatorFrequencies).toEqual([784, 988, 1175, 784, 988, 1175]);
  });

  it('plays three short–long pairs for mecpSafety', () => {
    playMessageNotification('mecpSafety');
    // 3 pairs × (short + long) = 6 oscillators at the same pitch
    expect(oscillatorCount).toBe(6);
    expect(oscillatorFrequencies).toEqual([880, 880, 880, 880, 880, 880]);
  });

  it('plays simultaneous 853+960 Hz EAS attention tones for mecpEas', () => {
    playMessageNotification('mecpEas');
    expect(oscillatorCount).toBe(2);
    expect(oscillatorFrequencies).toEqual([853, 960]);
  });

  it('plays a multi-cycle siren for mecpSiren at elevated gain', () => {
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
        const frequency = {
          value: 0,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        };
        return {
          type: 'sine',
          connect: vi.fn(),
          frequency,
          start: vi.fn(),
          stop: vi.fn(),
        };
      }
      createGain() {
        return {
          connect: vi.fn(),
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
    playMessageNotification('mecpSiren');
    // 6 cycles × 1 oscillator each (aligned with ~5s URGENT/EAS length)
    expect(oscillatorCount).toBe(6);
    expect(gainLevels.some((g) => g >= 0.5)).toBe(true);
  });

  it('defaults to channel profile when type is omitted', () => {
    playMessageNotification();
    expect(oscillatorCount).toBe(1);
    expect(oscillatorFrequencies).toEqual([880]);
  });

  it('resumes suspended AudioContext before scheduling tones', async () => {
    mockState = 'suspended';
    playMessageNotification('dm');
    expect(resumeMock).toHaveBeenCalledOnce();
    expect(oscillatorCount).toBe(0);
    await vi.waitFor(() => {
      expect(oscillatorCount).toBe(2);
    });
    expect(oscillatorFrequencies).toEqual([587.33, 783.99]);
  });
});
