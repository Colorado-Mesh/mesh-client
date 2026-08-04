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
  playVoiceFailTone,
  startVoiceRingback,
  stopVoiceCallTones,
} from '@/renderer/lib/reticulumVoiceCallTones';
import {
  applyVoiceTerminalFeedback,
  humanizeVoiceIpcError,
} from '@/renderer/lib/reticulumVoiceFeedback';
import { collectIdentityHashesForLxmfPeer } from '@/renderer/lib/rncpOfferPeerMatch';
import { RETICULUM_VOICE_OUTGOING_SAFETY_HANGUP_MS } from '@/renderer/lib/timeConstants';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';
import { useReticulumVoiceStore } from '@/renderer/stores/reticulumVoiceStore';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';
import { isReticulumVoiceSessionBusy, isVoiceStatusResponse } from '@/shared/voice-types';

let captureCtx: AudioContext | null = null;
let captureSource: MediaStreamAudioSourceNode | null = null;
// ScriptProcessor is deprecated in favor of AudioWorklet; kept for first-slice PCM
// capture without shipping a worklet module (Electron getUserMedia path).
// eslint-disable-next-line @typescript-eslint/no-deprecated -- see comment above
let captureProcessor: ScriptProcessorNode | null = null;
/** Muted sink so ScriptProcessor stays in the graph without mic monitor playback. */
let captureGain: GainNode | null = null;
let captureStream: MediaStream | null = null;
let captureGeneration = 0;
let playbackCtx: AudioContext | null = null;
let playbackCursor = 0;
let audioUnsub: (() => void) | null = null;
let txTimer: ReturnType<typeof setInterval> | null = null;
let pendingSamples: number[] = [];
let safetyHangupTimer: ReturnType<typeof setTimeout> | null = null;
/** Call generation for which capture/playback were last started (dedupe Answer + overlay). */
let mediaStartedForCallGeneration = -1;
/**
 * In-flight media start promise keyed by callGeneration — concurrent Answer + overlay
 * effect must share one getUserMedia (Columba inbound thrash).
 */
let mediaStartInFlight: Promise<void> | null = null;
let mediaStartInFlightGeneration = -1;
/** Throttle hot-path sendAudio failure logs. */
let lastTxDropWarnAtMs = 0;
/**
 * Contexts created during Call/Answer click (user gesture) before await.
 * Taken over by startCapture/startPlayback so Chromium does not leave them suspended.
 */
let primedCaptureCtx: AudioContext | null = null;
let primedPlaybackCtx: AudioContext | null = null;

/** Cap pending mic samples (~3 QualityHigh frames) when IPC backs up. */
const PENDING_SAMPLES_MAX = LXST_QUALITY_HIGH_FRAME_SAMPLES * 3;

function discardCaptureResources(
  stream: MediaStream | null,
  ctx: AudioContext | null,
  source: MediaStreamAudioSourceNode | null,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- paired with createScriptProcessor
  processor: ScriptProcessorNode | null,
  gain: GainNode | null,
): void {
  try {
    processor?.disconnect();
  } catch {
    // catch-no-log-ok
  }
  try {
    source?.disconnect();
  } catch {
    // catch-no-log-ok
  }
  try {
    gain?.disconnect();
  } catch {
    // catch-no-log-ok
  }
  if (stream) {
    for (const t of stream.getTracks()) {
      t.stop();
    }
  }
  if (ctx) {
    void ctx.close().catch(() => {
      // catch-no-log-ok close during stale-start cleanup
    });
  }
}

async function ensureMicAccess(): Promise<boolean> {
  try {
    const result = await window.electronAPI.media.ensureMicrophoneAccess();
    if (!result.granted) return false;
  } catch {
    // catch-no-log-ok continue to getUserMedia; Chromium may still prompt
  }
  return true;
}

async function resumeAudioContext(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // catch-no-log-ok resume may still fail without gesture in tests/headless
    }
  }
}

/**
 * Create/resume primed media contexts while still in a user-gesture stack
 * (Call / Answer click) so Chromium does not leave them suspended.
 */
export function warmReticulumVoiceAudioContexts(): void {
  try {
    if (!primedCaptureCtx || primedCaptureCtx.state === 'closed') {
      primedCaptureCtx = new AudioContext({ sampleRate: LXST_QUALITY_HIGH_SAMPLE_RATE_HZ });
    }
    void resumeAudioContext(primedCaptureCtx);
  } catch {
    // catch-no-log-ok AudioContext unavailable in test/headless
  }
  try {
    if (!primedPlaybackCtx || primedPlaybackCtx.state === 'closed') {
      primedPlaybackCtx = new AudioContext({ sampleRate: LXST_QUALITY_HIGH_SAMPLE_RATE_HZ });
    }
    void resumeAudioContext(primedPlaybackCtx);
  } catch {
    // catch-no-log-ok AudioContext unavailable in test/headless
  }
}

function takePrimedCaptureCtx(): AudioContext | null {
  const ctx = primedCaptureCtx;
  primedCaptureCtx = null;
  return ctx && ctx.state !== 'closed' ? ctx : null;
}

function takePrimedPlaybackCtx(): AudioContext | null {
  const ctx = primedPlaybackCtx;
  primedPlaybackCtx = null;
  return ctx && ctx.state !== 'closed' ? ctx : null;
}

function discardPrimedAudioContexts(): void {
  if (primedCaptureCtx) {
    void primedCaptureCtx.close().catch(() => {
      // catch-no-log-ok
    });
    primedCaptureCtx = null;
  }
  if (primedPlaybackCtx) {
    void primedPlaybackCtx.close().catch(() => {
      // catch-no-log-ok
    });
    primedPlaybackCtx = null;
  }
}

function stopCapture(): void {
  captureGeneration += 1;
  if (txTimer != null) {
    clearInterval(txTimer);
    txTimer = null;
  }
  pendingSamples = [];
  discardCaptureResources(captureStream, captureCtx, captureSource, captureProcessor, captureGain);
  captureProcessor = null;
  captureSource = null;
  captureGain = null;
  captureStream = null;
  captureCtx = null;
}

function stopPlayback(): void {
  if (audioUnsub) {
    audioUnsub();
    audioUnsub = null;
  }
  playbackCursor = 0;
  if (playbackCtx) {
    void playbackCtx.close().catch(() => {
      // catch-no-log-ok close during teardown
    });
    playbackCtx = null;
  }
}

export function stopReticulumVoiceMedia(): void {
  mediaStartedForCallGeneration = -1;
  mediaStartInFlight = null;
  mediaStartInFlightGeneration = -1;
  discardPrimedAudioContexts();
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
  mediaStartedForCallGeneration = -1;
  mediaStartInFlight = null;
  mediaStartInFlightGeneration = -1;
  lastTxDropWarnAtMs = 0;
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

function noteLocalTxDrop(reason: string): void {
  useReticulumVoiceStore.getState().incrementLocalTxDrops();
  const now = Date.now();
  if (now - lastTxDropWarnAtMs < 5000) return;
  lastTxDropWarnAtMs = now;
  console.debug(`[reticulumVoice] sendAudio drop: ${reason}`);
}

async function startCaptureAndTx(): Promise<void> {
  const primed = takePrimedCaptureCtx();
  stopCapture();
  const generation = captureGeneration;
  if (!(await ensureMicAccess())) {
    if (primed) {
      void primed.close().catch(() => {
        // catch-no-log-ok
      });
    }
    if (generation !== captureGeneration) return;
    pushAppToast(i18n.t('reticulumVoice.errors.micFailed'), 'error');
    return;
  }
  if (generation !== captureGeneration) {
    if (primed) {
      void primed.close().catch(() => {
        // catch-no-log-ok
      });
    }
    return;
  }

  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = primed;
  let source: MediaStreamAudioSourceNode | null = null;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- see captureProcessor note
  let processor: ScriptProcessorNode | null = null;
  let gain: GainNode | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    if (generation !== captureGeneration) {
      discardCaptureResources(stream, ctx, null, null, null);
      return;
    }
    if (!ctx || ctx.state === 'closed') {
      ctx = new AudioContext({ sampleRate: LXST_QUALITY_HIGH_SAMPLE_RATE_HZ });
    }
    await resumeAudioContext(ctx);
    if (generation !== captureGeneration) {
      discardCaptureResources(stream, ctx, null, null, null);
      return;
    }
    source = ctx.createMediaStreamSource(stream);
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- AudioWorklet deferred; see captureProcessor note
    processor = ctx.createScriptProcessor(4096, 1, 1);
    gain = ctx.createGain();
    gain.gain.value = 0;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- paired with createScriptProcessor
    processor.onaudioprocess = (ev) => {
      if (useReticulumVoiceStore.getState().microphoneMuted) return;
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- paired with createScriptProcessor
      const input = ev.inputBuffer.getChannelData(0);
      for (const s of input) {
        pendingSamples.push(s);
      }
      if (pendingSamples.length > PENDING_SAMPLES_MAX) {
        const drop = pendingSamples.length - PENDING_SAMPLES_MAX;
        pendingSamples.splice(0, drop);
        noteLocalTxDrop('pending_samples_cap');
      }
    };
    source.connect(processor);
    processor.connect(gain);
    gain.connect(ctx.destination);

    if (generation !== captureGeneration) {
      discardCaptureResources(stream, ctx, source, processor, gain);
      return;
    }

    captureStream = stream;
    captureCtx = ctx;
    captureSource = source;
    captureProcessor = processor;
    captureGain = gain;
  } catch (e) {
    discardCaptureResources(stream, ctx, source, processor, gain);
    throw e;
  }

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
            noteLocalTxDrop(resp.error ?? 'send_not_ok');
          }
        })
        .catch(() => {
          noteLocalTxDrop('send_ipc_throw');
        });
    },
    Math.max(20, frameMs),
  );
}

async function startPlayback(): Promise<void> {
  const primed = takePrimedPlaybackCtx();
  if (audioUnsub) {
    audioUnsub();
    audioUnsub = null;
  }
  playbackCursor = 0;
  if (playbackCtx) {
    void playbackCtx.close().catch(() => {
      // catch-no-log-ok close during teardown
    });
    playbackCtx = null;
  }
  playbackCtx = primed ?? new AudioContext({ sampleRate: LXST_QUALITY_HIGH_SAMPLE_RATE_HZ });
  await resumeAudioContext(playbackCtx);
  playbackCursor = playbackCtx.currentTime;
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
    const startAt = Math.max(playbackCursor, ctx.currentTime);
    node.start(startAt);
    playbackCursor = startAt + buffer.duration;
  });
}

export async function startReticulumVoiceMediaForActiveCall(): Promise<void> {
  const generation = useReticulumVoiceStore.getState().callGeneration;
  // Claimed generation (including 0 after a start) must not re-enter getUserMedia.
  if (mediaStartedForCallGeneration === generation) {
    return;
  }
  if (mediaStartInFlight && mediaStartInFlightGeneration === generation) {
    await mediaStartInFlight;
    return;
  }

  mediaStartInFlightGeneration = generation;
  const startPromise = (async () => {
    // Claim generation before awaits so concurrent callers coalesce.
    mediaStartedForCallGeneration = generation;
    try {
      await startPlayback();
      await startCaptureAndTx();
    } catch (e) {
      // Keep mediaStartedForCallGeneration claimed so overlay does not thrash getUserMedia.
      console.warn('[reticulumVoice] mic capture failed', e);
      pushAppToast(i18n.t('reticulumVoice.errors.micFailed'), 'error');
    } finally {
      if (mediaStartInFlightGeneration === generation) {
        mediaStartInFlight = null;
        mediaStartInFlightGeneration = -1;
      }
    }
  })();
  mediaStartInFlight = startPromise;
  await startPromise;
}

function peerIdentityForLxmfDest(lxmfPeerHash: string): string | null {
  const dest = canonicalizeReticulumDestinationHash(lxmfPeerHash);
  if (!dest) return null;
  const peer = useReticulumPeerStore.getState().getPeer(dest);
  return peer?.identity_hash ? canonicalizeReticulumDestinationHash(peer.identity_hash) : null;
}

function toastCallFailed(detail?: unknown): void {
  console.warn('[reticulumVoice] call IPC failed', detail);
  pushAppToast(i18n.t('reticulumVoice.errors.callFailed'), 'error');
}

function abortOutgoingCallAttempt(message?: string): void {
  clearSafetyHangupTimer();
  stopVoiceCallTones();
  playVoiceFailTone();
  const humanized = humanizeVoiceIpcError(message);
  useReticulumVoiceStore.getState().applyError(humanized);
  pushAppToast(humanized, 'error');
}

function terminalEventMatchesActiveCall(opts: {
  linkId?: string | null;
  callGeneration?: number | null;
  /** WS voice.error often omits link_id — allow matching the current session. */
  allowMissingLinkId?: boolean;
}): boolean {
  const state = useReticulumVoiceStore.getState();
  if (
    opts.callGeneration != null &&
    Number.isFinite(opts.callGeneration) &&
    opts.callGeneration !== state.callGeneration
  ) {
    return false;
  }
  const active = state.activeCall;
  if (!active) return false;
  const eventLink = (opts.linkId ?? '').trim().toLowerCase();
  const activeLink = active.link_id.trim().toLowerCase();
  if (eventLink && activeLink && eventLink !== activeLink) {
    return false;
  }
  // Empty event link_id: only accept while local call also has no link yet (outgoing pending),
  // unless this is an error path that routinely omits link_id.
  if (!eventLink && activeLink && !opts.allowMissingLinkId) {
    return false;
  }
  return true;
}

export async function reticulumVoiceCallPeer(
  lxmfPeerHash: string,
  opts?: { identityHash?: string | null },
): Promise<void> {
  const busyCall =
    useReticulumVoiceStore.getState().activeCall ?? useReticulumVoiceStore.getState().incomingCall;
  if (isReticulumVoiceSessionBusy(busyCall)) {
    pushAppToast(i18n.t('reticulumVoice.errors.callInProgress'), 'error');
    return;
  }

  // Warm AudioContexts in the click stack before any await.
  warmReticulumVoiceAudioContexts();

  const api = window.electronAPI.reticulum.voice;
  let statusRaw: unknown;
  try {
    statusRaw = await api.getStatus();
  } catch (e) {
    console.warn('[reticulumVoice] getStatus IPC failed', e);
    toastCallFailed(e);
    return;
  }
  if (!isVoiceStatusResponse(statusRaw)) {
    toastCallFailed('invalid voice status');
    return;
  }
  useReticulumVoiceStore.getState().applyStatus(statusRaw);
  if (!statusRaw.enabled || statusRaw.running === false) {
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

  try {
    const resp = await api.call({ identity_hash: resolved.dialHash });
    if (!resp.ok) {
      const msg = resp.error || i18n.t('reticulumVoice.errors.callFailed');
      console.warn(`[reticulumVoice] call failed reason=${msg}`);
      abortOutgoingCallAttempt(msg);
    }
  } catch (e) {
    console.warn('[reticulumVoice] call IPC failed', e);
    abortOutgoingCallAttempt(i18n.t('reticulumVoice.errors.callFailed'));
  }
}

export async function reticulumVoiceAnswer(): Promise<void> {
  warmReticulumVoiceAudioContexts();
  try {
    const resp = await window.electronAPI.reticulum.voice.answer();
    if (!resp.ok) {
      console.warn(
        '[reticulumVoice] answer failed',
        typeof resp.error === 'string' ? resp.error : JSON.stringify(resp),
      );
      pushAppToast(humanizeVoiceIpcError(resp.error), 'error');
      return;
    }
    console.info('[reticulumVoice] answer ok');
  } catch (e) {
    console.warn('[reticulumVoice] answer IPC failed', e);
    pushAppToast(i18n.t('reticulumVoice.errors.callFailed'), 'error');
    return;
  }
  stopVoiceCallTones();
  await startReticulumVoiceMediaForActiveCall();
}

export async function reticulumVoiceReject(): Promise<void> {
  clearSafetyHangupTimer();
  stopVoiceCallTones();
  try {
    const resp = await window.electronAPI.reticulum.voice.reject();
    if (!resp.ok) {
      pushAppToast(humanizeVoiceIpcError(resp.error), 'error');
      return;
    }
  } catch (e) {
    console.warn('[reticulumVoice] reject IPC failed', e);
    pushAppToast(i18n.t('reticulumVoice.errors.callFailed'), 'error');
    return;
  }
  stopReticulumVoiceMedia();
  useReticulumVoiceStore.getState().clearCall();
}

export async function reticulumVoiceHangup(opts?: {
  terminalReason?: string | null;
}): Promise<void> {
  clearSafetyHangupTimer();
  const reason = opts?.terminalReason ?? 'hangup';
  applyVoiceTerminalFeedback(reason);

  console.info(`[reticulumVoice] hangup reason=${reason}`);
  try {
    const resp = await window.electronAPI.reticulum.voice.hangup();
    if (!resp.ok) {
      pushAppToast(humanizeVoiceIpcError(resp.error), 'error');
      return;
    }
  } catch (e) {
    console.warn('[reticulumVoice] hangup IPC failed', e);
    pushAppToast(i18n.t('reticulumVoice.errors.callFailed'), 'error');
    return;
  }
  stopReticulumVoiceMedia();
  useReticulumVoiceStore.getState().clearCall();
}

export async function reticulumVoiceSetMuted(muted: boolean): Promise<void> {
  try {
    const resp = await window.electronAPI.reticulum.voice.mute({ muted });
    if (!resp.ok) {
      pushAppToast(humanizeVoiceIpcError(resp.error ?? 'mute'), 'error');
      return;
    }
  } catch (e) {
    console.warn('[reticulumVoice] mute IPC failed', e);
    pushAppToast(i18n.t('reticulumVoice.errors.muteFailed'), 'error');
    return;
  }
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
  callGeneration?: number | null;
}): void {
  if (
    !terminalEventMatchesActiveCall({
      ...opts,
      allowMissingLinkId: Boolean(opts.errorMessage),
    })
  ) {
    console.debug(
      '[reticulumVoice] ignoring stale terminal event',
      JSON.stringify({
        linkId: opts.linkId ?? null,
        reason: opts.reason ?? null,
        errorMessage: opts.errorMessage ?? null,
        callGeneration: opts.callGeneration ?? null,
      }),
    );
    return;
  }
  clearSafetyHangupTimer();
  stopReticulumVoiceMedia();
  const reason = opts.errorMessage ?? opts.reason ?? null;
  if (opts.errorMessage) {
    console.warn(
      `[reticulumVoice] voice.error message=${JSON.stringify(opts.errorMessage)} linkId=${opts.linkId ?? ''}`,
    );
  } else if (reason) {
    console.info(
      `[reticulumVoice] voice.terminated reason=${JSON.stringify(reason)} linkId=${opts.linkId ?? ''}`,
    );
  }
  applyVoiceTerminalFeedback(opts.errorMessage ? 'failed' : reason, {
    // errorMessage path uses applyError toast via humanized message below
    showToast: !opts.errorMessage,
  });

  if (opts.errorMessage) {
    const humanized = humanizeVoiceIpcError(opts.errorMessage);
    pushAppToast(humanized, 'error');
    useReticulumVoiceStore.getState().applyError(humanized, {
      callGeneration: useReticulumVoiceStore.getState().callGeneration,
    });
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
