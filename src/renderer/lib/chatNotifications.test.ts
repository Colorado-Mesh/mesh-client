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
