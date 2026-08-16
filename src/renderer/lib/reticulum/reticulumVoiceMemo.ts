import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { encodeF32LeBase64 } from '@/renderer/lib/reticulumVoiceAudio';
import { useReticulumVoiceMemoStore } from '@/renderer/stores/reticulumVoiceMemoStore';
import { useReticulumVoiceStore } from '@/renderer/stores/reticulumVoiceStore';
import { isReticulumVoiceSessionBusy } from '@/shared/voice-types';

/** Sample rate for voice memo capture (24 kHz mono, matches QualityMedium Opus). */
const MEMO_SAMPLE_RATE = 24_000;
/** Sidecar expects 60 ms frames → 1440 samples at 24 kHz. */
const MEMO_FRAME_SAMPLES = 1_440;
/** ScriptProcessor buffer size (power of two). */
const PROCESSOR_BUFFER_SIZE = 2048;
/** Maximum recording duration (~4 minutes). */
const MAX_RECORD_MS = 4 * 60 * 1000;

interface MemoRecordingSession {
  audioCtx: AudioContext;
  source: MediaStreamAudioSourceNode;
  // ScriptProcessor is deprecated in favor of AudioWorklet; kept for short memo capture.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- see comment above
  processor: ScriptProcessorNode;
  stream: MediaStream;
  sessionId: string;
  startedAt: number;
  pendingSamples: Float32Array;
  pendingCount: number;
  elapsedTimer: ReturnType<typeof setInterval>;
  maxTimer: ReturnType<typeof setTimeout>;
}

let activeSession: MemoRecordingSession | null = null;

function flushPendingFrames(session: MemoRecordingSession, forcePartial: boolean): void {
  while (session.pendingCount >= MEMO_FRAME_SAMPLES) {
    const frame = new Float32Array(MEMO_FRAME_SAMPLES);
    frame.set(session.pendingSamples.subarray(0, MEMO_FRAME_SAMPLES));
    session.pendingSamples.copyWithin(0, MEMO_FRAME_SAMPLES, session.pendingCount);
    session.pendingCount -= MEMO_FRAME_SAMPLES;
    const b64 = encodeF32LeBase64(frame);
    const sessionId = session.sessionId;
    void window.electronAPI.reticulum.voiceMemo
      .sendAudio({ session_id: sessionId, channels: 1, samples_b64: b64 })
      .catch((e: unknown) => {
        console.warn('[reticulumVoiceMemo] sendAudio failed:', errLikeToLogString(e));
      });
  }
  if (forcePartial && session.pendingCount > 0) {
    const frame = new Float32Array(MEMO_FRAME_SAMPLES);
    frame.set(session.pendingSamples.subarray(0, session.pendingCount));
    session.pendingCount = 0;
    const b64 = encodeF32LeBase64(frame);
    const sessionId = session.sessionId;
    void window.electronAPI.reticulum.voiceMemo
      .sendAudio({ session_id: sessionId, channels: 1, samples_b64: b64 })
      .catch((e: unknown) => {
        console.warn('[reticulumVoiceMemo] sendAudio failed:', errLikeToLogString(e));
      });
  }
}

/** Teardown recorder resources without changing store state. */
function teardownSession(flush: boolean): MemoRecordingSession | null {
  const session = activeSession;
  if (!session) return null;
  clearInterval(session.elapsedTimer);
  clearTimeout(session.maxTimer);
  if (flush) {
    flushPendingFrames(session, true);
  }
  try {
    session.processor.disconnect();
  } catch {
    // catch-no-log-ok: AudioWorkletNode may already be disconnected
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
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: MEMO_SAMPLE_RATE,
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

  const audioCtx = new AudioContext({ sampleRate: MEMO_SAMPLE_RATE });
  const source = audioCtx.createMediaStreamSource(stream);
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- AudioWorklet deferred; see processor note
  const processor = audioCtx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
  const pendingSamples = new Float32Array(MEMO_FRAME_SAMPLES * 4);

  const session: MemoRecordingSession = {
    audioCtx,
    source,
    processor,
    stream,
    sessionId,
    startedAt: Date.now(),
    pendingSamples,
    pendingCount: 0,
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
    if (activeSession?.sessionId !== sessionId) return;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- paired with createScriptProcessor
    const channelData = event.inputBuffer.getChannelData(0);
    const need = channelData.length;
    if (session.pendingCount + need > session.pendingSamples.length) {
      session.pendingCount = 0;
    }
    session.pendingSamples.set(channelData, session.pendingCount);
    session.pendingCount += need;
    while (session.pendingCount >= MEMO_FRAME_SAMPLES) {
      flushPendingFrames(session, false);
    }
  };

  source.connect(processor);
  processor.connect(audioCtx.destination);
  activeSession = session;
  useReticulumVoiceMemoStore.getState().startRecording(sessionId);
  return true;
}

/** Stop capture and return the sidecar session id (caller invokes voiceMemo.stop). */
export function stopReticulumVoiceMemoRecorder(): Promise<string | null> {
  const session = teardownSession(true);
  if (!session) return Promise.resolve(null);
  useReticulumVoiceMemoStore.getState().setStopping();
  return Promise.resolve(session.sessionId);
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
  const session = teardownSession(false);
  if (session) {
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
