import { errLikeToLogString } from '../errLikeToLogString';

/**
 * AudioWorklet processor source (inlined so it loads on mesh-client:// and file://
 * without a separate static asset path).
 */
export const VOICE_PCM_WORKLET_SOURCE = `
class VoicePcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      // Copy — AudioWorklet reuses the input buffer.
      const copy = new Float32Array(channel.length);
      copy.set(channel);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor('voice-pcm-processor', VoicePcmProcessor);
`;

export interface VoicePcmCaptureHandle {
  /** Disconnect graph nodes (does not close the AudioContext or stop the stream). */
  disconnect: () => void;
  kind: 'audioworklet' | 'scriptprocessor';
}

export interface AttachVoicePcmCaptureOptions {
  /**
   * ScriptProcessor buffer size (power of two). Default 4096.
   * AudioWorklet ignores this (uses its own quantum).
   */
  scriptProcessorBufferSize?: number;
}

/**
 * Attach mono PCM capture from `source` into `onPcm`.
 * Prefers AudioWorklet; falls back to deprecated ScriptProcessor when unavailable.
 */
export async function attachVoicePcmCapture(
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  onPcm: (samples: Float32Array) => void,
  options?: AttachVoicePcmCaptureOptions,
): Promise<VoicePcmCaptureHandle> {
  const silentGain = ctx.createGain();
  silentGain.gain.value = 0;

  const worklet = ctx.audioWorklet as AudioWorklet | undefined;
  if (worklet && typeof worklet.addModule === 'function') {
    try {
      const blob = new Blob([VOICE_PCM_WORKLET_SOURCE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      try {
        await worklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(ctx, 'voice-pcm-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (event.data instanceof Float32Array) onPcm(event.data);
      };
      source.connect(node);
      node.connect(silentGain);
      silentGain.connect(ctx.destination);
      return {
        kind: 'audioworklet',
        disconnect: () => {
          try {
            node.port.onmessage = null;
            node.disconnect();
          } catch {
            // catch-no-log-ok
          }
          try {
            source.disconnect();
          } catch {
            // catch-no-log-ok
          }
          try {
            silentGain.disconnect();
          } catch {
            // catch-no-log-ok
          }
        },
      };
    } catch (err) {
      console.debug(
        '[voicePcmCapture] AudioWorklet unavailable; ScriptProcessor fallback ' +
          errLikeToLogString(err),
      );
    }
  }

  const bufferSize = options?.scriptProcessorBufferSize ?? 4096;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- fallback when AudioWorklet missing
  const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- paired with createScriptProcessor
  processor.onaudioprocess = (ev) => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- paired with createScriptProcessor
    onPcm(ev.inputBuffer.getChannelData(0));
  };
  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(ctx.destination);
  return {
    kind: 'scriptprocessor',
    disconnect: () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- paired with createScriptProcessor
        processor.onaudioprocess = null;
        processor.disconnect();
      } catch {
        // catch-no-log-ok
      }
      try {
        source.disconnect();
      } catch {
        // catch-no-log-ok
      }
      try {
        silentGain.disconnect();
      } catch {
        // catch-no-log-ok
      }
    },
  };
}
