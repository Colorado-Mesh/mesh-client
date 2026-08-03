// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAT_NOTIF_MUTED_STORAGE_KEY } from './chatInactiveNotifications';
import {
  playVoiceBusyTone,
  playVoiceFailTone,
  resetVoiceCallTonesForTests,
  startVoiceRingback,
  stopVoiceCallTones,
} from './reticulumVoiceCallTones';

describe('reticulumVoiceCallTones', () => {
  let oscillatorCount = 0;

  beforeEach(() => {
    oscillatorCount = 0;
    resetVoiceCallTonesForTests();
    localStorage.removeItem(CHAT_NOTIF_MUTED_STORAGE_KEY);
    class MockAudioContext {
      state: AudioContextState = 'running';
      currentTime = 0;
      destination = {} as AudioDestinationNode;
      createOscillator() {
        oscillatorCount += 1;
        return {
          frequency: { value: 0 },
          connect: () => undefined,
          start: () => undefined,
          stop: () => undefined,
        };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime: () => undefined,
            exponentialRampToValueAtTime: () => undefined,
          },
          connect: () => undefined,
        };
      }
      resume() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('AudioContext', MockAudioContext);
  });

  afterEach(() => {
    resetVoiceCallTonesForTests();
    // Do not vi.unstubAllGlobals() — that strips jsdom localStorage for later tests.
    vi.stubGlobal('AudioContext', undefined);
  });

  it('starts ringback oscillators and stops cleanly', () => {
    startVoiceRingback();
    expect(oscillatorCount).toBeGreaterThan(0);
    const afterStart = oscillatorCount;
    startVoiceRingback(); // idempotent
    expect(oscillatorCount).toBe(afterStart);
    stopVoiceCallTones();
  });

  it('plays busy and fail tones', () => {
    playVoiceBusyTone();
    expect(oscillatorCount).toBeGreaterThan(0);
    oscillatorCount = 0;
    playVoiceFailTone();
    expect(oscillatorCount).toBe(2);
  });

  it('suppresses tones when notif muted', () => {
    localStorage.setItem(CHAT_NOTIF_MUTED_STORAGE_KEY, '1');
    startVoiceRingback();
    playVoiceBusyTone();
    playVoiceFailTone();
    expect(oscillatorCount).toBe(0);
  });
});
