/**
 * Remote shell session controller (Meshtastic `REMOTE_SHELL_APP`): lifecycle, sequencing, output
 * buffering, timeouts. State lives in `stores/remoteShellStore.ts`; frames in `./remoteShell.ts`.
 *
 * Protocol exception: Meshtastic only.
 *
 * Lifecycle: idle → opening (OPEN sent, waiting OPEN_OK) → open → closed | error.
 *  - `opening` fails after {@link REMOTE_SHELL_OPEN_TIMEOUT_MS} with `open_timeout`.
 *  - `open` auto-closes (CLOSE sent) after {@link REMOTE_SHELL_IDLE_TIMEOUT_MS} without user input
 *    or remote output, so an unattended session never stays authenticated on a remote node.
 *  - Frames are accepted only from the session's node with the session's id, so other nodes
 *    cannot inject output into the transcript.
 *  - Duplicate / out-of-order OUTPUT (seq <= last received) is dropped; skipped sequence numbers
 *    are counted in `gapCount` and surfaced to the operator.
 *
 * Failure point: send failures move the session to `error` (`send_failed`); the CLOSE sent on
 * teardown is best-effort (logged, never thrown) because the radio may already be gone.
 */
import { MS_PER_MINUTE, MS_PER_SECOND } from '@/shared/timeConstants';

import {
  appendRemoteShellOutput,
  patchRemoteShell,
  type RemoteShellErrorCode,
  resetRemoteShellStore,
  useRemoteShellStore,
} from '../../stores/remoteShellStore';
import { connectionDriver } from '../drivers/ConnectionDriver';
import { errLikeToLogString } from '../errLikeToLogString';
import {
  chunkRemoteShellInput,
  createRemoteShellSender,
  emptyRemoteShellFrame,
  type RemoteShellFrame,
  type RemoteShellSendFn,
  resolveRemoteShellIdentityId,
} from './remoteShell';

export const REMOTE_SHELL_OPEN_TIMEOUT_MS = 45 * MS_PER_SECOND;
export const REMOTE_SHELL_IDLE_TIMEOUT_MS = 10 * MS_PER_MINUTE;
/** Trailing ACK delay: coalesces bursts of OUTPUT frames into one airtime-cheap ACK. */
export const REMOTE_SHELL_ACK_DELAY_MS = 1500;
export const REMOTE_SHELL_DEFAULT_COLS = 80;
export const REMOTE_SHELL_DEFAULT_ROWS = 24;
const REMOTE_ERROR_DETAIL_MAX = 160;

let sender: RemoteShellSendFn | null = null;
let txSeq = 0;
let lastRxSeq = 0;
let openTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let ackTimer: ReturnType<typeof setTimeout> | null = null;
let decoder = new TextDecoder('utf-8', { fatal: false });
/** Serializes INPUT sends so keystroke chunks reach the radio in order. */
let sendChain: Promise<void> = Promise.resolve();

/** Test seam / DI: replace the frame sender. Pass null to restore the default. */
export function setRemoteShellSender(next: RemoteShellSendFn | null): void {
  sender = next;
}

function defaultSender(): RemoteShellSendFn {
  return createRemoteShellSender((id) => connectionDriver.getHandle(id));
}

function clearTimers(): void {
  if (openTimer) clearTimeout(openTimer);
  if (idleTimer) clearTimeout(idleTimer);
  if (ackTimer) clearTimeout(ackTimer);
  openTimer = idleTimer = ackTimer = null;
}

function randomSessionId(): number {
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] === 0);
  return buf[0];
}

function send(frame: RemoteShellFrame): Promise<void> {
  const { identityId, nodeNum } = useRemoteShellStore.getState();
  if (identityId == null || nodeNum == null) return Promise.reject(new Error('no session'));
  return (sender ?? defaultSender())(identityId, nodeNum, frame);
}

function fail(code: RemoteShellErrorCode, detail: string | null = null): void {
  clearTimers();
  patchRemoteShell({ phase: 'error', errorCode: code, errorDetail: detail, openedAt: null });
}

function armIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    closeRemoteShell('idle_timeout');
  }, REMOTE_SHELL_IDLE_TIMEOUT_MS);
}

function nextFrame(op: RemoteShellFrame['op'], sessionId: number): RemoteShellFrame {
  return { ...emptyRemoteShellFrame(op, sessionId), seq: ++txSeq, ackSeq: lastRxSeq };
}

/**
 * Begin a session with `nodeNum`. No-op (returns false) while another session is opening/open.
 * The caller (UI) is responsible for the security acknowledgement before calling this.
 */
export function openRemoteShell(
  nodeNum: number,
  size: { cols: number; rows: number } = {
    cols: REMOTE_SHELL_DEFAULT_COLS,
    rows: REMOTE_SHELL_DEFAULT_ROWS,
  },
): boolean {
  const current = useRemoteShellStore.getState();
  if (current.phase === 'opening' || current.phase === 'open') return false;
  clearTimers();
  const identityId = resolveRemoteShellIdentityId();
  const sessionId = randomSessionId();
  txSeq = 0;
  lastRxSeq = 0;
  decoder = new TextDecoder('utf-8', { fatal: false });
  sendChain = Promise.resolve();
  resetRemoteShellStore();
  if (identityId == null || !Number.isInteger(nodeNum) || nodeNum <= 0) {
    patchRemoteShell({ phase: 'error', errorCode: 'no_radio', nodeNum });
    return false;
  }
  patchRemoteShell({ phase: 'opening', identityId, nodeNum, sessionId });
  openTimer = setTimeout(() => {
    openTimer = null;
    if (useRemoteShellStore.getState().phase === 'opening') fail('open_timeout');
  }, REMOTE_SHELL_OPEN_TIMEOUT_MS);
  const open: RemoteShellFrame = {
    ...nextFrame('open', sessionId),
    cols: size.cols,
    rows: size.rows,
  };
  void send(open).catch((err: unknown) => {
    console.warn('[remoteShellSession] OPEN send failed ' + errLikeToLogString(err));
    if (useRemoteShellStore.getState().sessionId === sessionId) {
      fail('send_failed', errLikeToLogString(err).slice(0, REMOTE_ERROR_DETAIL_MAX));
    }
  });
  return true;
}

/** Send keystrokes / a command line. Returns false when no session is open. */
export function sendRemoteShellInput(text: string): boolean {
  const s = useRemoteShellStore.getState();
  if (s.phase !== 'open' || text === '') return false;
  armIdleTimer();
  const { sessionId } = s;
  for (const payload of chunkRemoteShellInput(text)) {
    const frame: RemoteShellFrame = { ...nextFrame('input', sessionId), payload };
    sendChain = sendChain.then(() =>
      send(frame).catch((err: unknown) => {
        console.warn('[remoteShellSession] INPUT send failed ' + errLikeToLogString(err));
        if (useRemoteShellStore.getState().sessionId === sessionId) {
          fail('send_failed', errLikeToLogString(err).slice(0, REMOTE_ERROR_DETAIL_MAX));
        }
      }),
    );
  }
  return true;
}

export function resizeRemoteShell(cols: number, rows: number): boolean {
  const s = useRemoteShellStore.getState();
  if (s.phase !== 'open') return false;
  const frame: RemoteShellFrame = { ...nextFrame('resize', s.sessionId), cols, rows };
  void send(frame).catch((err: unknown) => {
    console.debug('[remoteShellSession] RESIZE send failed ' + errLikeToLogString(err));
  });
  return true;
}

/**
 * End the session. Sends a best-effort CLOSE so the remote PTY does not linger, then marks the
 * session closed (or `error` when closing because of a timeout). Transcript is kept until
 * `clearRemoteShellOutput` / a new session so the operator can still read it.
 */
export function closeRemoteShell(reason?: 'idle_timeout'): void {
  const s = useRemoteShellStore.getState();
  if (s.phase !== 'opening' && s.phase !== 'open') return;
  clearTimers();
  const frame = nextFrame('close', s.sessionId);
  void send(frame).catch((err: unknown) => {
    console.debug('[remoteShellSession] CLOSE send failed ' + errLikeToLogString(err));
  });
  if (reason === 'idle_timeout') fail('idle_timeout');
  else patchRemoteShell({ phase: 'closed', openedAt: null });
}

/**
 * Radio disconnected / identity replaced: nothing can be sent, so drop the session and its
 * transcript without trying to transmit.
 */
export function abandonRemoteShellForIdentity(identityId: string): void {
  if (useRemoteShellStore.getState().identityId !== identityId) return;
  clearTimers();
  resetRemoteShellStore();
}

function scheduleAck(sessionId: number): void {
  if (ackTimer) return;
  ackTimer = setTimeout(() => {
    ackTimer = null;
    const s = useRemoteShellStore.getState();
    if (s.sessionId !== sessionId || s.phase !== 'open') return;
    const ack: RemoteShellFrame = { ...emptyRemoteShellFrame('ack', sessionId), ackSeq: lastRxSeq };
    void send(ack).catch((err: unknown) => {
      console.debug('[remoteShellSession] ACK send failed ' + errLikeToLogString(err));
    });
  }, REMOTE_SHELL_ACK_DELAY_MS);
}

/** Entry point from the module-port side effects for every `REMOTE_SHELL_APP` frame. */
export function handleRemoteShellFrame(
  identityId: string,
  from: number,
  frame: RemoteShellFrame,
): void {
  const s = useRemoteShellStore.getState();
  if (s.phase !== 'opening' && s.phase !== 'open') return;
  if (s.identityId !== identityId || s.nodeNum !== from || s.sessionId !== frame.sessionId) {
    console.debug('[remoteShellSession] ignored frame for another node/session');
    return;
  }
  switch (frame.op) {
    case 'openOk':
      if (s.phase === 'opening') {
        if (openTimer) clearTimeout(openTimer);
        openTimer = null;
        patchRemoteShell({ phase: 'open', openedAt: Date.now() });
        armIdleTimer();
      }
      break;
    case 'output': {
      // OUTPUT before OPEN_OK means the OK was lost; the session is evidently live.
      if (s.phase === 'opening') {
        if (openTimer) clearTimeout(openTimer);
        openTimer = null;
        patchRemoteShell({ phase: 'open', openedAt: Date.now() });
      }
      if (frame.seq !== 0 && frame.seq <= lastRxSeq) return;
      if (frame.seq !== 0) {
        if (lastRxSeq !== 0 && frame.seq > lastRxSeq + 1) {
          patchRemoteShell({
            gapCount: useRemoteShellStore.getState().gapCount + (frame.seq - lastRxSeq - 1),
          });
        }
        lastRxSeq = frame.seq;
      }
      appendRemoteShellOutput(decoder.decode(frame.payload, { stream: true }));
      armIdleTimer();
      scheduleAck(s.sessionId);
      break;
    }
    case 'closed':
      clearTimers();
      patchRemoteShell({ phase: 'closed', openedAt: null });
      break;
    case 'error': {
      const detail = new TextDecoder().decode(frame.payload).slice(0, REMOTE_ERROR_DETAIL_MAX);
      const sanitized = detail.replace(/[^\x20-\x7e\u00a0-\uffff]/g, ' ').trim();
      if (s.phase === 'opening') fail('remote_error', sanitized);
      else patchRemoteShell({ errorCode: 'remote_error', errorDetail: sanitized });
      break;
    }
    default:
      break;
  }
}

/** @internal */
export function resetRemoteShellSessionForTests(): void {
  clearTimers();
  sender = null;
  txSeq = 0;
  lastRxSeq = 0;
  sendChain = Promise.resolve();
  resetRemoteShellStore();
}
