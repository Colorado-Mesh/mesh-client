/**
 * Session state for the Meshtastic remote shell (`REMOTE_SHELL_APP`): at most one PTY session.
 *
 * Protocol exception: Meshtastic only (see `lib/meshtastic/remoteShell.ts`). Memory-only by design —
 * the transcript can contain secrets (credentials, keys, config) and is never persisted, exported
 * to SQLite, or written to logs; it is dropped on close, disconnect, or app exit.
 *
 * Failure point: none here; the controller (`remoteShellSession.ts`) owns I/O, timers and
 * timeouts and records failures in `errorCode` / `errorDetail`.
 */
import { create } from 'zustand';

import type { IdentityId } from '../lib/types';

export type RemoteShellPhase = 'idle' | 'opening' | 'open' | 'closed' | 'error';

export type RemoteShellErrorCode =
  'open_timeout' | 'idle_timeout' | 'send_failed' | 'remote_error' | 'no_radio';

/** Output buffer ceiling. The oldest lines are dropped first; a notice flag tells the UI. */
export const REMOTE_SHELL_MAX_OUTPUT_CHARS = 64 * 1024;

export interface RemoteShellState {
  phase: RemoteShellPhase;
  identityId: IdentityId | null;
  nodeNum: number | null;
  sessionId: number;
  /** Sanitized output (control sequences stripped), bounded by {@link REMOTE_SHELL_MAX_OUTPUT_CHARS}. */
  output: string;
  /** True once older output has been discarded to stay under the cap. */
  outputTruncated: boolean;
  /** Frames skipped because a sequence number was missed (lossy LoRa). */
  gapCount: number;
  /** Epoch ms when the session reached `open`; null otherwise. */
  openedAt: number | null;
  errorCode: RemoteShellErrorCode | null;
  /** Short remote-supplied or transport error text (display only, already length-bounded). */
  errorDetail: string | null;
}

const INITIAL: RemoteShellState = {
  phase: 'idle',
  identityId: null,
  nodeNum: null,
  sessionId: 0,
  output: '',
  outputTruncated: false,
  gapCount: 0,
  openedAt: null,
  errorCode: null,
  errorDetail: null,
};

export const useRemoteShellStore = create<RemoteShellState>()(() => ({ ...INITIAL }));

/* eslint-disable no-control-regex -- stripping terminal control bytes is the purpose of this module */
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
// Remaining C0 controls (except \n, \t) and DEL, plus a bare ESC.
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
/* eslint-enable no-control-regex */

/**
 * Make remote output safe to show in a `<pre>`: strip ANSI/OSC sequences and control bytes, and
 * normalize CRLF/CR. The remote side is untrusted; this is never interpreted as a terminal.
 */
export function sanitizeRemoteShellOutput(text: string): string {
  return text
    .replace(ANSI_OSC, '')
    .replace(ANSI_CSI, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(CONTROL_CHARS, '');
}

/** Append and trim to the cap at a line boundary when possible. */
export function appendBoundedOutput(
  current: string,
  chunk: string,
  max = REMOTE_SHELL_MAX_OUTPUT_CHARS,
): { output: string; truncated: boolean } {
  const joined = current + chunk;
  if (joined.length <= max) return { output: joined, truncated: false };
  let cut = joined.length - max;
  const nl = joined.indexOf('\n', cut);
  if (nl !== -1 && nl - cut < 512) cut = nl + 1;
  return { output: joined.slice(cut), truncated: true };
}

export function patchRemoteShell(patch: Partial<RemoteShellState>): void {
  useRemoteShellStore.setState(patch);
}

export function appendRemoteShellOutput(rawChunk: string): void {
  const chunk = sanitizeRemoteShellOutput(rawChunk);
  if (!chunk) return;
  useRemoteShellStore.setState((s) => {
    const next = appendBoundedOutput(s.output, chunk);
    return { output: next.output, outputTruncated: s.outputTruncated || next.truncated };
  });
}

export function clearRemoteShellOutput(): void {
  useRemoteShellStore.setState({ output: '', outputTruncated: false });
}

export function resetRemoteShellStore(): void {
  useRemoteShellStore.setState({ ...INITIAL });
}
