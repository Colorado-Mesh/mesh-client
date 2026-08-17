import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  encodeF32LeBase64,
  packVoiceMemoFrame,
  VOICE_MEMO_FRAME_SAMPLES,
  VOICE_MEMO_SAMPLE_RATE_HZ,
} from '@/renderer/lib/reticulumVoiceAudio';
import { useReticulumVoiceMemoStore } from '@/renderer/stores/reticulumVoiceMemoStore';
import { useReticulumVoiceStore } from '@/renderer/stores/reticulumVoiceStore';
import { isReticulumVoiceSessionBusy } from '@/shared/voice-types';

/** ScriptProcessor buffer size (power of two). */
const PROCESSOR_BUFFER_SIZE = 2048;
/** Maximum recording duration (~4 minutes). */
const MAX_RECORD_MS = 4 * 60 * 1000;
/** Pending PCM ring capacity (at capture rate) before we expand. */
const PENDING_RING_FRAMES = 16;

interface MemoRecordingSession {
  audioCtx: AudioContext;
  source: MediaStreamAudioSourceNode;
  // ScriptProcessor is deprecated in favor of AudioWorklet; kept for short memo capture.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- see comment above
  processor: ScriptProcessorNode;
  /** Zero-gain sink so ScriptProcessor runs without audible monitor bleed. */
  silentGain: GainNode;
  stream: MediaStream;
  sessionId: string;
  startedAt: number;
  /** Capture-rate mono ring (before 24 kHz framing). */
  pendingSamples: Float32Array;
  pendingCount: number;
  /** Serialized IPC queue so Opus packets stay in order. */
  sendQueue: Promise<void>;
  sendFailed: boolean;
  /** Set when teardown clears activeSession so queued sends can drain without side effects. */
  abandoned: boolean;
  elapsedTimer: ReturnType<typeof setInterval>;
  maxTimer: ReturnType<typeof setTimeout>;
}

let activeSession: MemoRecordingSession | null = null;

function abortRecording(session: MemoRecordingSession, error: string): void {
  if (session.sendFailed) return;
  session.sendFailed = true;
  console.warn('[reticulumVoiceMemo] aborting recording:', error);
  teardownSession(session, false);
  void window.electronAPI.reticulum.voiceMemo
    .cancel({ session_id: session.sessionId })
    .catch((e: unknown) => {
      console.warn('[reticulumVoiceMemo] cancel after abort failed:', errLikeToLogString(e));
    });
  useReticulumVoiceMemoStore.getState().setError(error);
}

function enqueueSendAudio(session: MemoRecordingSession, samplesB64: string): void {
  if (session.sendFailed) return;
  const sessionId = session.sessionId;
  session.sendQueue = session.sendQueue
    .then(async () => {
      if (session.sendFailed || session.abandoned) return;
      const res = await window.electronAPI.reticulum.voiceMemo.sendAudio({
        session_id: sessionId,
        channels: 1,
        samples_b64: samplesB64,
      });
      if (!res.ok) {
        abortRecording(session, res.error ?? 'send_audio_failed');
      }
    })
    .catch((e: unknown) => {
      console.warn('[reticulumVoiceMemo] sendAudio failed:', errLikeToLogString(e));
      abortRecording(session, 'send_audio_failed');
    });
}

/**
 * Resample capture-rate pending PCM into 24 kHz / 1440-sample frames and queue IPC.
 * When `forcePartial`, pads the last incomplete frame with silence.
 */
function flushPendingFrames(session: MemoRecordingSession, forcePartial: boolean): void {
  if (session.sendFailed) return;
  const rate = session.audioCtx.sampleRate || VOICE_MEMO_SAMPLE_RATE_HZ;
  // Enough capture samples for one 60 ms memo frame at the current rate.
  const capturePerFrame = Math.max(
    1,
    Math.round((rate * VOICE_MEMO_FRAME_SAMPLES) / VOICE_MEMO_SAMPLE_RATE_HZ),
  );

  while (session.pendingCount >= capturePerFrame) {
    const chunk = session.pendingSamples.subarray(0, capturePerFrame);
    const frame = packVoiceMemoFrame(chunk, rate, 1);
    session.pendingSamples.copyWithin(0, capturePerFrame, session.pendingCount);
    session.pendingCount -= capturePerFrame;
    if (!frame) continue;
    enqueueSendAudio(session, encodeF32LeBase64(frame));
  }

  if (forcePartial && session.pendingCount > 0) {
    const padded = new Float32Array(capturePerFrame);
    padded.set(session.pendingSamples.subarray(0, session.pendingCount));
    session.pendingCount = 0;
    const frame = packVoiceMemoFrame(padded, rate, 1);
    if (frame) {
      enqueueSendAudio(session, encodeF32LeBase64(frame));
    }
  }
}

async function drainSendQueue(session: MemoRecordingSession): Promise<void> {
  await session.sendQueue;
}

/** Teardown recorder resources without changing store state. */
function teardownSession(
  session: MemoRecordingSession,
  flush: boolean,
): MemoRecordingSession | null {
  if (activeSession !== session) return null;
  clearInterval(session.elapsedTimer);
  clearTimeout(session.maxTimer);
  if (flush && !session.sendFailed) {
    flushPendingFrames(session, true);
  }
  try {
    session.processor.disconnect();
  } catch {
    // catch-no-log-ok: AudioWorkletNode may already be disconnected
  }
  try {
    session.silentGain.disconnect();
  } catch {
    // catch-no-log-ok: GainNode may already be disconnected
  }
  try {
    session.source.disconnect();
  } catch {
    // catch-no-log-ok: MediaStreamSource may already be disconnected
  }
  try {
    void session.audioCtx.close();
  } catch {
    // catch-no-log-ok: AudioContext may already be closed
  }
  for (const track of session.stream.getTracks()) {
    track.stop();
  }
  activeSession = null;
  session.abandoned = true;
  return session;
}

/**
 * Start a voice memo recording session.
 * Refuses if LXST voice call is in progress.
 */
export async function startReticulumVoiceMemo(): Promise<boolean> {
  const store = useReticulumVoiceMemoStore.getState();
  if (store.phase !== 'idle' && store.phase !== 'error') {
    console.warn('[reticulumVoiceMemo] start ignored — phase:', store.phase);
    return false;
  }

  const voiceStore = useReticulumVoiceStore.getState();
  if (isReticulumVoiceSessionBusy(voiceStore.activeCall)) {
    console.warn('[reticulumVoiceMemo] cannot record during active LXST voice call');
    store.setError('call_busy');
    return false;
  }

  store.setStarting();

  try {
    const mic = await window.electronAPI.media.ensureMicrophoneAccess();
    if (!mic.granted) {
      useReticulumVoiceMemoStore.getState().setError('mic_denied');
      return false;
    }
  } catch (e) {
    console.warn('[reticulumVoiceMemo] mic permission IPC failed:', errLikeToLogString(e));
    useReticulumVoiceMemoStore.getState().setError('mic_denied');
    return false;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: VOICE_MEMO_SAMPLE_RATE_HZ,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
  } catch (e) {
    console.warn('[reticulumVoiceMemo] mic access denied:', errLikeToLogString(e));
    useReticulumVoiceMemoStore.getState().setError('mic_denied');
    return false;
  }

  let sessionId: string;
  try {
    const res = await window.electronAPI.reticulum.voiceMemo.start();
    if (!res.ok || !res.session_id) {
      useReticulumVoiceMemoStore.getState().setError(res.error ?? 'start_failed');
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return false;
    }
    sessionId = res.session_id;
  } catch (e) {
    console.warn('[reticulumVoiceMemo] sidecar start failed:', errLikeToLogString(e));
    useReticulumVoiceMemoStore.getState().setError('sidecar_unavailable');
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return false;
  }

  const ringCap = Math.max(
    PROCESSOR_BUFFER_SIZE * PENDING_RING_FRAMES,
    VOICE_MEMO_FRAME_SAMPLES * 8,
  );
  const pendingSamples = new Float32Array(ringCap);

  let audioCtx: AudioContext;
  let source: MediaStreamAudioSourceNode;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- AudioWorklet deferred; see processor note
  let processor: ScriptProcessorNode;
  let silentGain: GainNode;
  try {
    audioCtx = new AudioContext({ sampleRate: VOICE_MEMO_SAMPLE_RATE_HZ });
    source = audioCtx.createMediaStreamSource(stream);
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- AudioWorklet deferred; see processor note
    processor = audioCtx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
    silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioCtx.destination);
  } catch (e) {
    console.warn('[reticulumVoiceMemo] audio graph setup failed:', errLikeToLogString(e));
    for (const track of stream.getTracks()) {
      track.stop();
    }
    void window.electronAPI.reticulum.voiceMemo
      .cancel({ session_id: sessionId })
      .catch((cancelErr: unknown) => {
        console.warn(
          '[reticulumVoiceMemo] cancel after audio setup failed:',
          errLikeToLogString(cancelErr),
        );
      });
    useReticulumVoiceMemoStore.getState().setError('start_failed');
    return false;
  }

  const session: MemoRecordingSession = {
    audioCtx,
    source,
    processor,
    silentGain,
    stream,
    sessionId,
    startedAt: Date.now(),
    pendingSamples,
    pendingCount: 0,
    sendQueue: Promise.resolve(),
    sendFailed: false,
    abandoned: false,
    elapsedTimer: setInterval(() => {
      const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
      useReticulumVoiceMemoStore.getState().tickElapsed(elapsed);
    }, 500),
    maxTimer: setTimeout(() => {
      void stopReticulumVoiceMemo();
    }, MAX_RECORD_MS),
  };

  // eslint-disable-next-line @typescript-eslint/no-deprecated -- paired with createScriptProcessor
  processor.onaudioprocess = (event) => {
    if (activeSession?.sessionId !== sessionId || session.sendFailed) return;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- paired with createScriptProcessor
    const channelData = event.inputBuffer.getChannelData(0);
    const need = channelData.length;
    if (session.pendingCount + need > session.pendingSamples.length) {
      // Expand ring instead of dropping audio under brief backpressure.
      const next = new Float32Array(
        Math.max(session.pendingSamples.length * 2, session.pendingCount + need),
      );
      next.set(session.pendingSamples.subarray(0, session.pendingCount));
      session.pendingSamples = next;
    }
    session.pendingSamples.set(channelData, session.pendingCount);
    session.pendingCount += need;
    flushPendingFrames(session, false);
  };

  activeSession = session;
  useReticulumVoiceMemoStore.getState().startRecording(sessionId);
  return true;
}

/** Stop capture, drain in-flight PCM IPC, and return the sidecar session id. */
export async function stopReticulumVoiceMemoRecorder(): Promise<string | null> {
  const session = activeSession;
  if (!session) return null;
  const torn = teardownSession(session, true);
  if (!torn) return null;
  useReticulumVoiceMemoStore.getState().setStopping();
  await drainSendQueue(torn);
  if (torn.sendFailed) return null;
  return torn.sessionId;
}

/** Stop recording and store Ogg result on the memo store. */
export async function stopReticulumVoiceMemo(): Promise<void> {
  const sessionId = await stopReticulumVoiceMemoRecorder();
  if (!sessionId) return;
  try {
    const res = await window.electronAPI.reticulum.voiceMemo.stop({ session_id: sessionId });
    if (!res.ok || !res.ogg_base64) {
      useReticulumVoiceMemoStore.getState().setError(res.error ?? 'stop_failed');
      return;
    }
    useReticulumVoiceMemoStore.getState().applyStopResult({
      oggBase64: res.ogg_base64,
      durationMs: res.duration_ms ?? 0,
      sizeBytes: res.size_bytes ?? 0,
    });
  } catch (e) {
    console.warn('[reticulumVoiceMemo] stop failed:', errLikeToLogString(e));
    useReticulumVoiceMemoStore.getState().setError('stop_failed');
  }
}

/** Cancel the active recording and reset store to idle. */
export function cancelReticulumVoiceMemo(): Promise<void> {
  const session = activeSession;
  if (session) {
    teardownSession(session, false);
    void window.electronAPI.reticulum.voiceMemo
      .cancel({ session_id: session.sessionId })
      .catch((e: unknown) => {
        console.warn('[reticulumVoiceMemo] cancel failed:', errLikeToLogString(e));
      });
  }
  useReticulumVoiceMemoStore.getState().reset();
  return Promise.resolve();
}

/** True while mic capture is active. */
export function isReticulumVoiceMemoRecording(): boolean {
  return activeSession != null;
}
