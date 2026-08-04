// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAT_NOTIF_MUTED_STORAGE_KEY } from './chatInactiveNotifications';
import {
  playVoiceBusyTone,
  playVoiceFailTone,
  resetVoiceCallTonesForTests,
  startVoiceDialTone,
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
          disconnect: () => undefined,
        };
      }
      createGain() {
        return {
          gain: {
            value: 0,
            setValueAtTime: () => undefined,
            exponentialRampToValueAtTime: () => undefined,
          },
          connect: () => undefined,
          disconnect: () => undefined,
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

  it('starts continuous dial tone and is idempotent', () => {
    startVoiceDialTone();
    expect(oscillatorCount).toBe(2);
    startVoiceDialTone();
    expect(oscillatorCount).toBe(2);
    stopVoiceCallTones();
  });

  it('starts UK double-ring ringback (4 oscillators per burst) and is idempotent', () => {
    startVoiceRingback();
    // Two rings × dual tone (400+450) = 4 oscillators per burst.
    expect(oscillatorCount).toBe(4);
    const afterStart = oscillatorCount;
    startVoiceRingback(); // idempotent — no second burst until interval
    expect(oscillatorCount).toBe(afterStart);
    stopVoiceCallTones();
  });

  it('switching dial to ringback stops dial oscillators from staying active', () => {
    startVoiceDialTone();
    expect(oscillatorCount).toBe(2);
    oscillatorCount = 0;
    startVoiceRingback();
    expect(oscillatorCount).toBeGreaterThan(0);
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
    startVoiceDialTone();
    startVoiceRingback();
    playVoiceBusyTone();
    playVoiceFailTone();
    expect(oscillatorCount).toBe(0);
  });
});
