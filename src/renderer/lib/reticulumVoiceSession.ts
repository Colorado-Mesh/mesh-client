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
import {
  playVoiceBusyTone,
  playVoiceFailTone,
  startVoiceRingback,
  stopVoiceCallTones,
} from '@/renderer/lib/reticulumVoiceCallTones';
import {
  classifyVoiceTerminalReason,
  voiceToastKeyForTerminal,
} from '@/renderer/lib/reticulumVoiceOutcome';
import { collectIdentityHashesForLxmfPeer } from '@/renderer/lib/rncpOfferPeerMatch';
import { RETICULUM_VOICE_OUTGOING_SAFETY_HANGUP_MS } from '@/renderer/lib/timeConstants';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';
import { useReticulumVoiceStore } from '@/renderer/stores/reticulumVoiceStore';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';

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
let safetyHangupTimer: ReturnType<typeof setTimeout> | null = null;

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

function clearSafetyHangupTimer(): void {
  if (safetyHangupTimer != null) {
    clearTimeout(safetyHangupTimer);
    safetyHangupTimer = null;
  }
}

/** @internal Test helper */
export function resetReticulumVoiceSessionTimersForTests(): void {
  clearSafetyHangupTimer();
}

function scheduleOutgoingSafetyHangup(generation: number): void {
  clearSafetyHangupTimer();
  safetyHangupTimer = setTimeout(() => {
    safetyHangupTimer = null;
    const state = useReticulumVoiceStore.getState();
    if (state.callGeneration !== generation) return;
    const status = state.activeCall?.status;
    if (!status || status === 'established') return;
    console.warn('[reticulumVoice] safety hangup — outgoing never established');
    void reticulumVoiceHangup({ terminalReason: 'safety_timeout' });
  }, RETICULUM_VOICE_OUTGOING_SAFETY_HANGUP_MS);
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

  // One QualityHigh frame ≈ 60 ms @ 48 kHz; tick near frame duration (not 2×) so we
  // stay around ~16–17 IPC posts/s under the dedicated voiceSendAudio rate limit.
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
      void window.electronAPI.reticulum.voice
        .sendAudio({
          profile: LXST_QUALITY_HIGH_PROFILE,
          channels: LXST_QUALITY_HIGH_CHANNELS,
          samples_b64: encodeF32LeBase64(packed),
        })
        .then((resp) => {
          if (!resp.ok) {
            useReticulumVoiceStore.getState().incrementLocalTxDrops();
          }
        })
        .catch(() => {
          useReticulumVoiceStore.getState().incrementLocalTxDrops();
        });
    },
    Math.max(20, frameMs),
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

function peerIdentityForLxmfDest(lxmfPeerHash: string): string | null {
  const dest = canonicalizeReticulumDestinationHash(lxmfPeerHash);
  if (!dest) return null;
  const peer = useReticulumPeerStore.getState().getPeer(dest);
  return peer?.identity_hash ? canonicalizeReticulumDestinationHash(peer.identity_hash) : null;
}

export async function reticulumVoiceCallPeer(
  lxmfPeerHash: string,
  opts?: { identityHash?: string | null },
): Promise<void> {
  const api = window.electronAPI.reticulum.voice;
  const status = await api.getStatus();
  useReticulumVoiceStore.getState().applyStatus(status);
  if (!status.enabled || status.running === false) {
    pushAppToast(i18n.t('reticulumVoice.errors.notRunning'), 'error');
    return;
  }
  const dest = canonicalizeReticulumDestinationHash(lxmfPeerHash);
  const peerIdentity = opts?.identityHash
    ? canonicalizeReticulumDestinationHash(opts.identityHash)
    : peerIdentityForLxmfDest(lxmfPeerHash);
  const candidates = dest ? collectIdentityHashesForLxmfPeer(dest) : new Set<string>();
  const resolved = resolveVoiceDialIdentityHash({
    identityHash: peerIdentity,
    candidateIdentityHashes: candidates,
    destinationHash: dest,
  });
  if ('errorKey' in resolved) {
    console.warn('[reticulumVoice] dial aborted — no identity or destination hash');
    pushAppToast(i18n.t(resolved.errorKey), 'error');
    return;
  }

  console.info(
    `[reticulumVoice] call start role=outgoing remote=${resolved.dialHash.slice(0, 16)} source=${resolved.source}`,
  );

  // Optimistic UI so Hang up is available before WS voice.update.
  useReticulumVoiceStore.getState().beginOutgoing(resolved.dialHash);
  const generation = useReticulumVoiceStore.getState().callGeneration;
  startVoiceRingback();
  scheduleOutgoingSafetyHangup(generation);

  const resp = await api.call({ identity_hash: resolved.dialHash });
  if (!resp.ok) {
    const msg = resp.error || i18n.t('reticulumVoice.errors.callFailed');
    console.warn(`[reticulumVoice] call failed reason=${msg}`);
    clearSafetyHangupTimer();
    stopVoiceCallTones();
    playVoiceFailTone();
    useReticulumVoiceStore.getState().applyError(msg);
    pushAppToast(msg, 'error');
    return;
  }
  // Mic deferred until connecting/established (overlay effect).
}

export async function reticulumVoiceAnswer(): Promise<void> {
  const resp = await window.electronAPI.reticulum.voice.answer();
  if (!resp.ok) {
    pushAppToast(resp.error || i18n.t('reticulumVoice.errors.callFailed'), 'error');
    return;
  }
  stopVoiceCallTones();
  await startReticulumVoiceMediaForActiveCall();
}

export async function reticulumVoiceReject(): Promise<void> {
  clearSafetyHangupTimer();
  stopReticulumVoiceMedia();
  stopVoiceCallTones();
  await window.electronAPI.reticulum.voice.reject();
  useReticulumVoiceStore.getState().clearCall();
}

export async function reticulumVoiceHangup(opts?: {
  terminalReason?: string | null;
}): Promise<void> {
  clearSafetyHangupTimer();
  stopReticulumVoiceMedia();
  const reason = opts?.terminalReason ?? 'hangup';
  const kind = classifyVoiceTerminalReason(reason);
  stopVoiceCallTones();
  if (kind === 'busy') playVoiceBusyTone();
  else if (kind === 'noAnswer' || kind === 'failed' || kind === 'rejected') playVoiceFailTone();

  const toastKey = voiceToastKeyForTerminal(kind);
  if (toastKey && kind !== 'completed') {
    pushAppToast(i18n.t(toastKey), 'error');
  }

  console.info(`[reticulumVoice] hangup reason=${reason}`);
  try {
    await window.electronAPI.reticulum.voice.hangup();
  } catch (e) {
    console.warn('[reticulumVoice] hangup IPC failed', e);
  }
  useReticulumVoiceStore.getState().clearCall();
}

export async function reticulumVoiceSetMuted(muted: boolean): Promise<void> {
  await window.electronAPI.reticulum.voice.mute({ muted });
  useReticulumVoiceStore.getState().setMicrophoneMuted(muted);
}

/**
 * Handle terminal signalling from WS (busy / rejected / timeout / completed).
 * Clears media, tones, safety timer; toast for unsuccessful outcomes.
 */
export function handleReticulumVoiceTerminal(opts: {
  linkId?: string | null;
  reason?: string | null;
  errorMessage?: string | null;
}): void {
  clearSafetyHangupTimer();
  stopReticulumVoiceMedia();
  const reason = opts.errorMessage ?? opts.reason ?? null;
  const kind = classifyVoiceTerminalReason(reason);
  stopVoiceCallTones();
  if (kind === 'busy') playVoiceBusyTone();
  else if (kind === 'rejected' || kind === 'noAnswer' || kind === 'failed') playVoiceFailTone();

  const toastKey = voiceToastKeyForTerminal(kind);
  if (toastKey) {
    pushAppToast(i18n.t(toastKey), 'error');
  }

  if (opts.errorMessage) {
    useReticulumVoiceStore.getState().applyError(opts.errorMessage);
  } else {
    useReticulumVoiceStore.getState().applyTerminated(opts.linkId ?? null, reason);
  }
}

/** Sync ringback / stop tones from active call status (overlay / runtime). */
export function syncReticulumVoiceProgressTones(status: string | null | undefined): void {
  if (status === 'calling' || status === 'ringing') {
    startVoiceRingback();
    return;
  }
  if (status === 'established' || status === 'connecting') {
    stopVoiceCallTones();
    if (status === 'established') {
      clearSafetyHangupTimer();
    }
    return;
  }
  if (!status) {
    stopVoiceCallTones();
    clearSafetyHangupTimer();
  }
}
