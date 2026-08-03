/**
 * High-level LXST voice session helpers (dial / answer / hangup + mic stream).
 */

import { pushAppToast } from '@/renderer/components/Toast';
import i18n from '@/renderer/lib/i18n';
import {
  encodeF32LeBase64,
  LXST_QUALITY_HIGH_CHANNELS,
  LXST_QUALITY_HIGH_FRAME_SAMPLES,
  LXST_QUALITY_HIGH_PROFILE,
  LXST_QUALITY_HIGH_SAMPLE_RATE_HZ,
  packQualityHighFrame,
  resolveVoiceDialIdentityHash,
} from '@/renderer/lib/reticulumVoiceAudio';
import { collectIdentityHashesForLxmfPeer } from '@/renderer/lib/rncpOfferPeerMatch';
import { useReticulumVoiceStore } from '@/renderer/stores/reticulumVoiceStore';

let captureCtx: AudioContext | null = null;
let captureSource: MediaStreamAudioSourceNode | null = null;
// ScriptProcessor is deprecated in favor of AudioWorklet; kept for first-slice PCM
// capture without shipping a worklet module (Electron getUserMedia path).
// eslint-disable-next-line @typescript-eslint/no-deprecated -- see comment above
let captureProcessor: ScriptProcessorNode | null = null;
let captureStream: MediaStream | null = null;
let playbackCtx: AudioContext | null = null;
let audioUnsub: (() => void) | null = null;
let txTimer: ReturnType<typeof setInterval> | null = null;
let pendingSamples: number[] = [];

async function ensureMicAccess(): Promise<boolean> {
  try {
    const result = await window.electronAPI.media.ensureMicrophoneAccess();
    if (!result.granted) return false;
  } catch {
    // catch-no-log-ok continue to getUserMedia; Chromium may still prompt
  }
  return true;
}

function stopCapture(): void {
  if (txTimer != null) {
    clearInterval(txTimer);
    txTimer = null;
  }
  pendingSamples = [];
  try {
    captureProcessor?.disconnect();
  } catch {
    // catch-no-log-ok
  }
  try {
    captureSource?.disconnect();
  } catch {
    // catch-no-log-ok
  }
  captureProcessor = null;
  captureSource = null;
  if (captureStream) {
    for (const t of captureStream.getTracks()) {
      t.stop();
    }
    captureStream = null;
  }
  if (captureCtx) {
    void captureCtx.close().catch(() => {
      // catch-no-log-ok close during teardown
    });
    captureCtx = null;
  }
}

function stopPlayback(): void {
  if (audioUnsub) {
    audioUnsub();
    audioUnsub = null;
  }
  if (playbackCtx) {
    void playbackCtx.close().catch(() => {
      // catch-no-log-ok close during teardown
    });
    playbackCtx = null;
  }
}

export function stopReticulumVoiceMedia(): void {
  stopCapture();
  stopPlayback();
}

async function startCaptureAndTx(): Promise<void> {
  stopCapture();
  if (!(await ensureMicAccess())) {
    pushAppToast(i18n.t('reticulumVoice.errors.notRunning'), 'error');
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
  captureStream = stream;
  const ctx = new AudioContext({ sampleRate: LXST_QUALITY_HIGH_SAMPLE_RATE_HZ });
  captureCtx = ctx;
  const source = ctx.createMediaStreamSource(stream);
  captureSource = source;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- AudioWorklet deferred; see captureProcessor note
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  captureProcessor = processor;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- paired with createScriptProcessor
  processor.onaudioprocess = (ev) => {
    if (useReticulumVoiceStore.getState().microphoneMuted) return;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- paired with createScriptProcessor
    const input = ev.inputBuffer.getChannelData(0);
    for (const s of input) {
      pendingSamples.push(s);
    }
  };
  source.connect(processor);
  processor.connect(ctx.destination);

  const frameMs = (LXST_QUALITY_HIGH_FRAME_SAMPLES / LXST_QUALITY_HIGH_SAMPLE_RATE_HZ) * 1000;
  txTimer = setInterval(
    () => {
      if (useReticulumVoiceStore.getState().microphoneMuted) {
        pendingSamples = [];
        return;
      }
      if (pendingSamples.length < LXST_QUALITY_HIGH_FRAME_SAMPLES) return;
      const chunk = pendingSamples.splice(0, LXST_QUALITY_HIGH_FRAME_SAMPLES);
      const packed = packQualityHighFrame(
        Float32Array.from(chunk),
        LXST_QUALITY_HIGH_SAMPLE_RATE_HZ,
        1,
      );
      if (!packed) return;
      void window.electronAPI.reticulum.voice.sendAudio({
        profile: LXST_QUALITY_HIGH_PROFILE,
        channels: LXST_QUALITY_HIGH_CHANNELS,
        samples_b64: encodeF32LeBase64(packed),
      });
    },
    Math.max(20, frameMs / 2),
  );
}

function startPlayback(): void {
  stopPlayback();
  playbackCtx = new AudioContext({ sampleRate: LXST_QUALITY_HIGH_SAMPLE_RATE_HZ });
  audioUnsub = useReticulumVoiceStore.getState().subscribeAudio((channels, samples) => {
    const ctx = playbackCtx;
    if (!ctx || samples.length === 0) return;
    const frames = Math.floor(samples.length / Math.max(1, channels));
    if (frames <= 0) return;
    const buffer = ctx.createBuffer(Math.max(1, channels), frames, ctx.sampleRate);
    if (channels <= 1) {
      buffer.copyToChannel(Float32Array.from(samples), 0);
    } else {
      for (let c = 0; c < channels; c += 1) {
        const ch = new Float32Array(frames);
        for (let i = 0; i < frames; i += 1) {
          ch[i] = samples[i * channels + c] ?? 0;
        }
        buffer.copyToChannel(ch, c);
      }
    }
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    node.start();
  });
}

export async function startReticulumVoiceMediaForActiveCall(): Promise<void> {
  startPlayback();
  try {
    await startCaptureAndTx();
  } catch (e) {
    console.warn('[reticulumVoice] mic capture failed', e);
  }
}

export async function reticulumVoiceCallPeer(lxmfPeerHash: string): Promise<void> {
  const api = window.electronAPI.reticulum.voice;
  const status = await api.getStatus();
  useReticulumVoiceStore.getState().applyStatus(status);
  if (!status.enabled || status.running === false) {
    pushAppToast(i18n.t('reticulumVoice.errors.notRunning'), 'error');
    return;
  }
  const candidates = collectIdentityHashesForLxmfPeer(lxmfPeerHash);
  const resolved = resolveVoiceDialIdentityHash({
    candidateIdentityHashes: candidates,
  });
  if ('errorKey' in resolved) {
    pushAppToast(i18n.t(resolved.errorKey), 'error');
    return;
  }
  const resp = await api.call({ identity_hash: resolved.identityHash });
  if (!resp.ok) {
    pushAppToast(resp.error || i18n.t('reticulumVoice.errors.callFailed'), 'error');
  } else {
    await startReticulumVoiceMediaForActiveCall();
  }
}

export async function reticulumVoiceAnswer(): Promise<void> {
  const resp = await window.electronAPI.reticulum.voice.answer();
  if (!resp.ok) {
    pushAppToast(resp.error || i18n.t('reticulumVoice.errors.callFailed'), 'error');
    return;
  }
  await startReticulumVoiceMediaForActiveCall();
}

export async function reticulumVoiceReject(): Promise<void> {
  stopReticulumVoiceMedia();
  await window.electronAPI.reticulum.voice.reject();
  useReticulumVoiceStore.getState().clearCall();
}

export async function reticulumVoiceHangup(): Promise<void> {
  stopReticulumVoiceMedia();
  await window.electronAPI.reticulum.voice.hangup();
  useReticulumVoiceStore.getState().clearCall();
}

export async function reticulumVoiceSetMuted(muted: boolean): Promise<void> {
  await window.electronAPI.reticulum.voice.mute({ muted });
  useReticulumVoiceStore.getState().setMicrophoneMuted(muted);
}
