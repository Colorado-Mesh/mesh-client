import { describe, expect, it, vi } from 'vitest';

import { attachVoicePcmCapture, VOICE_PCM_WORKLET_SOURCE } from './voicePcmCapture';

describe('voicePcmCapture', () => {
  it('exports a registerProcessor worklet source', () => {
    expect(VOICE_PCM_WORKLET_SOURCE).toContain('registerProcessor');
    expect(VOICE_PCM_WORKLET_SOURCE).toContain('voice-pcm-processor');
    expect(VOICE_PCM_WORKLET_SOURCE).not.toMatch(/ScriptProcessor/);
  });

  it('uses AudioWorklet when available', async () => {
    const onPcm = vi.fn();
    const sourceDisconnect = vi.fn();
    const nodeDisconnect = vi.fn();
    const sourceConnect = vi.fn();
    const nodeConnect = vi.fn();
    const silentGainDisconnect = vi.fn();
    const silentGainConnect = vi.fn();

    const delivered: ((data: Float32Array) => void)[] = [];
    const node = {
      port: {
        set onmessage(handler: ((event: MessageEvent) => void) | null) {
          delivered.length = 0;
          if (handler) {
            delivered.push((data) => {
              handler({ data } as MessageEvent);
            });
          }
        },
        get onmessage() {
          return null;
        },
      },
      connect: nodeConnect,
      disconnect: nodeDisconnect,
    };
    const silentGain = {
      connect: silentGainConnect,
      disconnect: silentGainDisconnect,
      gain: { value: 0 },
    };
    const source = { connect: sourceConnect, disconnect: sourceDisconnect };
    const addModule = vi.fn(() => Promise.resolve());
    const AudioWorkletNode = vi.fn(function AudioWorkletNodeMock() {
      return node;
    });
    vi.stubGlobal('AudioWorkletNode', AudioWorkletNode);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:voice-pcm'),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      'Blob',
      class {
        constructor(public parts: unknown[]) {}
      },
    );

    const createScriptProcessor = vi.fn();
    const ctx = {
      audioWorklet: { addModule },
      createScriptProcessor,
      createGain: vi.fn(() => silentGain),
      destination: {},
    } as unknown as AudioContext;

    try {
      const handle = await attachVoicePcmCapture(
        ctx,
        source as unknown as MediaStreamAudioSourceNode,
        onPcm,
      );
      expect(handle.kind).toBe('audioworklet');
      expect(createScriptProcessor).not.toHaveBeenCalled();
      expect(addModule).toHaveBeenCalledOnce();
      expect(AudioWorkletNode).toHaveBeenCalledWith(
        ctx,
        'voice-pcm-processor',
        expect.objectContaining({
          channelCount: 1,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers',
        }),
      );
      expect(sourceConnect).toHaveBeenCalledWith(node);
      const samples = new Float32Array([0.1, -0.2]);
      expect(delivered).toHaveLength(1);
      delivered[0]?.(samples);
      expect(onPcm).toHaveBeenCalledWith(samples);
      handle.disconnect();
      expect(nodeDisconnect).toHaveBeenCalled();
      expect(sourceDisconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
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
      { scriptProcessorBufferSize: 2048 },
    );
    expect(handle.kind).toBe('scriptprocessor');
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- asserting fallback path
    expect(ctx.createScriptProcessor).toHaveBeenCalledWith(2048, 1, 1);
    handle.disconnect();
    expect(disconnect).toHaveBeenCalled();
  });
});
