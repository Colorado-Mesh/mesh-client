import { describe, expect, it, vi } from 'vitest';

import { attachVoicePcmCapture, VOICE_PCM_WORKLET_SOURCE } from './voicePcmCapture';

describe('voicePcmCapture', () => {
  it('exports a registerProcessor worklet source', () => {
    expect(VOICE_PCM_WORKLET_SOURCE).toContain('registerProcessor');
    expect(VOICE_PCM_WORKLET_SOURCE).toContain('voice-pcm-processor');
    expect(VOICE_PCM_WORKLET_SOURCE).not.toMatch(/ScriptProcessor/);
  });

  it('falls back to ScriptProcessor when AudioWorklet is unavailable', async () => {
    const onPcm = vi.fn();
    const disconnect = vi.fn();
    const connect = vi.fn();

    const processor = {
      connect,
      disconnect,

      onaudioprocess: null as ((ev: unknown) => void) | null,
    };
    const silentGain = { connect, disconnect, gain: { value: 0 } };
    const source = { connect, disconnect };
    const ctx = {
      audioWorklet: undefined,

      createScriptProcessor: vi.fn(() => processor),
      createGain: vi.fn(() => silentGain),
      destination: {},
    } as unknown as AudioContext;

    const handle = await attachVoicePcmCapture(
      ctx,
      source as unknown as MediaStreamAudioSourceNode,
      onPcm,
    );
    expect(handle.kind).toBe('scriptprocessor');
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- asserting fallback path
    expect(ctx.createScriptProcessor).toHaveBeenCalled();
    handle.disconnect();
    expect(disconnect).toHaveBeenCalled();
  });
});
