// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAT_NOTIF_MUTED_STORAGE_KEY } from './chatInactiveNotifications';
import {
  DTMF_BURST_MS,
  dtmfKeysFromPeerHash,
  isOutgoingConnectToneSequenceActive,
  playVoiceBusyTone,
  playVoiceFailTone,
  playVoiceReorderTone,
  resetVoiceCallTonesForTests,
  startOutgoingConnectToneSequence,
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
    vi.useRealTimers();
  });

  it('starts continuous dial tone and is idempotent', () => {
    startVoiceDialTone();
    expect(oscillatorCount).toBe(2);
    startVoiceDialTone();
    expect(oscillatorCount).toBe(2);
    stopVoiceCallTones();
  });

  it('starts UK double-ring ringback (4 oscillators per burst) on a 3s cycle', () => {
    vi.useFakeTimers();
    startVoiceRingback();
    // Two rings × dual tone (400+450) = 4 oscillators per burst.
    expect(oscillatorCount).toBe(4);
    const afterStart = oscillatorCount;
    startVoiceRingback(); // idempotent — no second burst until interval
    expect(oscillatorCount).toBe(afterStart);
    vi.advanceTimersByTime(2999);
    expect(oscillatorCount).toBe(afterStart);
    vi.advanceTimersByTime(1);
    expect(oscillatorCount).toBe(afterStart + 4);
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

  it('plays reorder (3× dual) and busy (2× dual) within 1.5s cadence', () => {
    playVoiceReorderTone();
    // 3 ON windows × 480+620 = 6 oscillators.
    expect(oscillatorCount).toBe(6);
    oscillatorCount = 0;
    playVoiceBusyTone();
    // 2 ON windows × 480+620 = 4 oscillators.
    expect(oscillatorCount).toBe(4);
    oscillatorCount = 0;
    playVoiceFailTone();
    expect(oscillatorCount).toBe(2);
  });

  it('maps peer hash to stable 4 DTMF keys', () => {
    expect(dtmfKeysFromPeerHash('a1b2' + '0'.repeat(28))).toBe('A1B2');
    expect(dtmfKeysFromPeerHash('a1b2' + '0'.repeat(28))).toBe(
      dtmfKeysFromPeerHash('A1B2ffffffffffffffffffffffffffffffff'),
    );
    expect(dtmfKeysFromPeerHash('0123' + 'f'.repeat(28))).toBe('0123');
    expect(dtmfKeysFromPeerHash('ef' + '0'.repeat(30))).toBe('*#00');
    expect(dtmfKeysFromPeerHash('abcd')).not.toBe(dtmfKeysFromPeerHash('dcba'));
  });

  it('connect sequence: dial 2s → DTMF → ringback; stop cancels later ring', () => {
    vi.useFakeTimers();
    const hash = 'a1b2' + 'c'.repeat(28);
    startOutgoingConnectToneSequence(hash);
    expect(isOutgoingConnectToneSequenceActive()).toBe(true);
    expect(oscillatorCount).toBe(2); // dial
    startOutgoingConnectToneSequence(hash); // idempotent
    expect(oscillatorCount).toBe(2);

    oscillatorCount = 0;
    vi.advanceTimersByTime(1999);
    expect(oscillatorCount).toBe(0);
    expect(isOutgoingConnectToneSequenceActive()).toBe(true);

    vi.advanceTimersByTime(1);
    // 4 DTMF keys × dual tone = 8 oscillators.
    expect(oscillatorCount).toBe(8);
    expect(isOutgoingConnectToneSequenceActive()).toBe(true);

    oscillatorCount = 0;
    vi.advanceTimersByTime(DTMF_BURST_MS - 1);
    expect(oscillatorCount).toBe(0);
    vi.advanceTimersByTime(1);
    // UK ringback burst: 4 oscillators; sequence no longer active.
    expect(oscillatorCount).toBe(4);
    expect(isOutgoingConnectToneSequenceActive()).toBe(false);

    oscillatorCount = 0;
    startOutgoingConnectToneSequence(hash);
    expect(isOutgoingConnectToneSequenceActive()).toBe(true);
    vi.advanceTimersByTime(500);
    stopVoiceCallTones();
    expect(isOutgoingConnectToneSequenceActive()).toBe(false);
    oscillatorCount = 0;
    vi.advanceTimersByTime(5000);
    expect(oscillatorCount).toBe(0);
  });

  it('suppresses tones when notif muted', () => {
    localStorage.setItem(CHAT_NOTIF_MUTED_STORAGE_KEY, '1');
    startVoiceDialTone();
    startVoiceRingback();
    startOutgoingConnectToneSequence('a'.repeat(32));
    playVoiceReorderTone();
    playVoiceBusyTone();
    playVoiceFailTone();
    expect(oscillatorCount).toBe(0);
  });
});
