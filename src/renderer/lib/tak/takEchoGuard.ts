import { MS_PER_MINUTE } from '../timeConstants';
import type { IdentityId } from '../types';

/** How long a sent message is remembered so its own echo off the mesh is not mirrored back. */
const TAK_ECHO_WINDOW_MS = 2 * MS_PER_MINUTE;
const TAK_ECHO_MAX_ENTRIES = 64;

interface SentEntry {
  key: string;
  atMs: number;
}

let recentlySent: SentEntry[] = [];

function echoKey(identityId: IdentityId, channelIndex: number, text: string): string {
  return `${identityId}\u0000${channelIndex}\u0000${text}`;
}

/** Remember text this app is about to transmit on a channel for a TAK client. */
export function rememberTakSend(
  identityId: IdentityId,
  channelIndex: number,
  text: string,
  nowMs: number = Date.now(),
): void {
  const cutoff = nowMs - TAK_ECHO_WINDOW_MS;
  recentlySent = recentlySent.filter((e) => e.atMs > cutoff).slice(-(TAK_ECHO_MAX_ENTRIES - 1));
  recentlySent.push({ key: echoKey(identityId, channelIndex, text.trim()), atMs: nowMs });
}

/**
 * True once for a heard channel message that is this app's own transmission of a TAK client's
 * message. The TAK clients already have it, so mirroring it again would duplicate it.
 */
export function consumeTakEcho(
  identityId: IdentityId,
  channelIndex: number,
  text: string,
  nowMs: number = Date.now(),
): boolean {
  const key = echoKey(identityId, channelIndex, text.trim());
  const cutoff = nowMs - TAK_ECHO_WINDOW_MS;
  const index = recentlySent.findIndex((e) => e.key === key && e.atMs > cutoff);
  if (index < 0) return false;
  recentlySent.splice(index, 1);
  return true;
}

/** Test-only: forget remembered sends. */
export function resetTakEchoForTests(): void {
  recentlySent = [];
}
