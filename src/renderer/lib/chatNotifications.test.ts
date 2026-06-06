import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  playMessageNotification,
  resetChatNotificationAudioContextForTests,
} from './chatNotifications';

describe('playMessageNotification', () => {
  let constructCount = 0;

  beforeEach(() => {
    constructCount = 0;
    resetChatNotificationAudioContextForTests();
    class MockAudioContext {
      state = 'running';
      destination = {};
      currentTime = 0;
      createOscillator() {
        return {
          connect: vi.fn(),
          frequency: { value: 0 },
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
});
