import { describe, expect, it } from 'vitest';

import { audioBufferToWavBase64, encodePcmWavMono16 } from './notificationSoundWav';

describe('notificationSoundWav', () => {
  it('encodes a mono PCM WAV with a valid RIFF/WAVE header', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const bytes = new Uint8Array(encodePcmWavMono16(samples, 44_100));
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WAVE');
    expect(bytes.length).toBe(44 + samples.length * 2);
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it('mixes multi-channel AudioBuffer samples to mono base64 WAV', () => {
    const left = new Float32Array([1, 0]);
    const right = new Float32Array([-1, 0]);
    const buffer = {
      length: 2,
      numberOfChannels: 2,
      sampleRate: 8_000,
      getChannelData: (channel: number) => (channel === 0 ? left : right),
    } as AudioBuffer;
    const encoded = audioBufferToWavBase64(buffer);
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    const view = new DataView(bytes.buffer);
    // (1 + -1) / 2 = 0 for the first sample
    expect(view.getInt16(44, true)).toBe(0);
  });
});
