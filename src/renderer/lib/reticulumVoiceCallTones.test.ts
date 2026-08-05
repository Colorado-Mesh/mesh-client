// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAT_NOTIF_MUTED_STORAGE_KEY } from './chatInactiveNotifications';
import {
  DTMF_BURST_MS,
  DTMF_TO_RING_GAP_MS,
  dtmfKeysFromPeerHash,
  isOutgoingConnectToneSequenceActive,
  MODEM_HANDSHAKE_MS,
  playVoiceBusyTone,
  playVoiceFailTone,
  playVoiceReorderTone,
  promoteOutgoingConnectSequenceToRingback,
  resetVoiceCallTonesForTests,
  startOutgoingConnectToneSequence,
  startVoiceDialTone,
  startVoiceRingback,
  stopVoiceCallTones,
} from './reticulumVoiceCallTones';

describe('reticulumVoiceCallTones', () => {
  let oscillatorCount = 0;
  let bufferSourceCount = 0;

  beforeEach(() => {
    oscillatorCount = 0;
    bufferSourceCount = 0;
    resetVoiceCallTonesForTests();
    localStorage.removeItem(CHAT_NOTIF_MUTED_STORAGE_KEY);
    class MockAudioContext {
      state: AudioContextState = 'running';
      currentTime = 0;
      sampleRate = 48000;
      destination = {} as AudioDestinationNode;
      createOscillator() {
        oscillatorCount += 1;
        const osc: {
          type: string;
          frequency: {
            value: number;
            setValueAtTime: () => undefined;
            linearRampToValueAtTime: () => undefined;
          };
          connect: () => undefined;
          start: () => undefined;
          stop: () => undefined;
          disconnect: () => undefined;
          onended: ((this: OscillatorNode, ev: Event) => void) | null;
        } = {
          type: 'sine',
          frequency: {
            value: 0,
            setValueAtTime: () => undefined,
            linearRampToValueAtTime: () => undefined,
          },
          connect: () => undefined,
          start: () => undefined,
          stop: () => {
            const handler = osc.onended;
            if (handler) {
              handler.call(osc as unknown as OscillatorNode, new Event('ended'));
            }
          },
          disconnect: () => undefined,
          onended: null,
        };
        return osc;
      }
      createGain() {
        return {
          gain: {
            value: 0,
            setValueAtTime: () => undefined,
            exponentialRampToValueAtTime: () => undefined,
            linearRampToValueAtTime: () => undefined,
          },
          connect: () => undefined,
          disconnect: () => undefined,
        };
      }
      createBiquadFilter() {
        return {
          type: 'bandpass',
          frequency: { setValueAtTime: () => undefined },
          Q: { setValueAtTime: () => undefined },
          connect: () => undefined,
          disconnect: () => undefined,
        };
      }
      createBuffer(_channels: number, length: number) {
        return {
          getChannelData: () => new Float32Array(length),
        };
      }
      createBufferSource() {
        bufferSourceCount += 1;
        return {
          buffer: null as AudioBuffer | null,
          loop: false,
          connect: () => undefined,
          start: () => undefined,
          stop: () => undefined,
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

  it('maps peer hash to stable 4 DTMF keys via full-hash fold', () => {
    const a = 'a1b2' + '0'.repeat(28);
    expect(dtmfKeysFromPeerHash(a)).toBe(dtmfKeysFromPeerHash(a.toUpperCase()));
    expect(dtmfKeysFromPeerHash(a)).toHaveLength(4);
    // Same prefix, different later bytes → different melody (prefix-only bug).
    const samePrefixA = 'aaaa' + '0'.repeat(28);
    const samePrefixB = 'aaaa' + '0'.repeat(27) + '1';
    expect(dtmfKeysFromPeerHash(samePrefixA)).not.toBe(dtmfKeysFromPeerHash(samePrefixB));
    const h1 = '0123456789abcdef0123456789abcdef';
    const h2 = '0123456789abcdef0123456789abcdee';
    expect(dtmfKeysFromPeerHash(h1)).not.toBe(dtmfKeysFromPeerHash(h2));
  });

  it('connect sequence: dial → DTMF → modem handshake → carrier; promote cuts to ringback', () => {
    vi.useFakeTimers();
    const hash = 'a1b2' + 'c'.repeat(28);
    startOutgoingConnectToneSequence(hash);
    expect(isOutgoingConnectToneSequenceActive()).toBe(true);
    expect(oscillatorCount).toBe(2); // dial
    startOutgoingConnectToneSequence(hash); // idempotent
    expect(oscillatorCount).toBe(2);

    oscillatorCount = 0;
    bufferSourceCount = 0;
    vi.advanceTimersByTime(1999);
    expect(oscillatorCount).toBe(0);
    expect(isOutgoingConnectToneSequenceActive()).toBe(true);

    vi.advanceTimersByTime(1);
    // 4 DTMF keys × dual tone = 8 oscillators.
    expect(oscillatorCount).toBe(8);
    expect(isOutgoingConnectToneSequenceActive()).toBe(true);

    oscillatorCount = 0;
    bufferSourceCount = 0;
    vi.advanceTimersByTime(DTMF_BURST_MS + DTMF_TO_RING_GAP_MS - 1);
    expect(oscillatorCount).toBe(0);
    expect(bufferSourceCount).toBe(0);
    expect(isOutgoingConnectToneSequenceActive()).toBe(true);

    vi.advanceTimersByTime(1);
    // Handshake: answer osc + chirp osc + train buffer source.
    expect(oscillatorCount).toBe(2);
    expect(bufferSourceCount).toBe(1);
    expect(isOutgoingConnectToneSequenceActive()).toBe(true);

    oscillatorCount = 0;
    bufferSourceCount = 0;
    vi.advanceTimersByTime(MODEM_HANDSHAKE_MS - 1);
    expect(oscillatorCount).toBe(0);
    expect(bufferSourceCount).toBe(0);

    vi.advanceTimersByTime(1);
    // Carrier: sine osc + looping noise buffer (no ringback yet).
    expect(oscillatorCount).toBe(1);
    expect(bufferSourceCount).toBe(1);
    expect(isOutgoingConnectToneSequenceActive()).toBe(true);

    oscillatorCount = 0;
    bufferSourceCount = 0;
    promoteOutgoingConnectSequenceToRingback();
    // UK ringback burst: 4 oscillators; sequence no longer active.
    expect(oscillatorCount).toBe(4);
    expect(isOutgoingConnectToneSequenceActive()).toBe(false);

    oscillatorCount = 0;
    bufferSourceCount = 0;
    vi.advanceTimersByTime(5000);
    // Heartbeat / carrier timers cancelled — only ringback interval may fire.
    expect(bufferSourceCount).toBe(0);
    expect(oscillatorCount).toBe(4); // one more UK ringback cycle at 3s
    stopVoiceCallTones();
  });

  it('stop during modem cancels carrier and later ringback', () => {
    vi.useFakeTimers();
    const hash = 'a1b2' + 'c'.repeat(28);
    startOutgoingConnectToneSequence(hash);
    vi.advanceTimersByTime(2000 + DTMF_BURST_MS + DTMF_TO_RING_GAP_MS);
    expect(isOutgoingConnectToneSequenceActive()).toBe(true);
    oscillatorCount = 0;
    bufferSourceCount = 0;
    stopVoiceCallTones();
    expect(isOutgoingConnectToneSequenceActive()).toBe(false);
    vi.advanceTimersByTime(MODEM_HANDSHAKE_MS + 5000);
    expect(oscillatorCount).toBe(0);
    expect(bufferSourceCount).toBe(0);
  });

  it('suppresses tones when notif muted', () => {
    localStorage.setItem(CHAT_NOTIF_MUTED_STORAGE_KEY, '1');
    startVoiceDialTone();
    startVoiceRingback();
    startOutgoingConnectToneSequence('a'.repeat(32));
    promoteOutgoingConnectSequenceToRingback();
    playVoiceReorderTone();
    playVoiceBusyTone();
    playVoiceFailTone();
    expect(oscillatorCount).toBe(0);
    expect(bufferSourceCount).toBe(0);
  });
});
