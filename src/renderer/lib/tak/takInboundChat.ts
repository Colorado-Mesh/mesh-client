import type { TakChatTarget, TAKInboundChat } from '@/shared/tak-types';

import { getTakRadio } from '../../stores/takChannelStore';
import { getTakRelayPrefs } from '../../stores/takRelayPrefsStore';
import { errLikeToLogString } from '../errLikeToLogString';
import type { IdentityId } from '../types';
import { consumeTakEcho, rememberTakSend } from './takEchoGuard';
import { listTakServedChannels } from './takServedChannels';

/**
 * UTF-8 budget for one mesh message sent on behalf of a TAK client, callsign prefix included.
 * Conservative for both protocols: a MeshCore channel message also carries the sender name.
 */
export const TAK_MESH_SEND_MAX_BYTES = 160;
const ELLIPSIS = '…';
/** A send that has not settled by now is treated as failed so it cannot hold up later messages. */
export const TAK_MESH_SEND_TIMEOUT_MS = 15_000;

const encoder = new TextEncoder();

/** Size of `text` in UTF-8 bytes. */
function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

/** Longest prefix of `text` that fits `maxBytes` of UTF-8 without splitting a code point. */
function truncateUtf8(text: string, maxBytes: number): string {
  let out = '';
  let used = 0;
  for (const ch of text) {
    const size = utf8Length(ch);
    if (used + size > maxBytes) break;
    out += ch;
    used += size;
  }
  return out;
}

/**
 * Text to transmit for a TAK client's message: `[CALLSIGN] text`, since every bridged message
 * leaves from this app's own node. Cut to the byte budget with an ellipsis when it is too long.
 */
export function formatTakMeshText(
  senderCallsign: string,
  text: string,
  maxBytes: number = TAK_MESH_SEND_MAX_BYTES,
): string {
  const full = `[${senderCallsign.trim()}] ${text.trim()}`;
  if (utf8Length(full) <= maxBytes) return full;
  return truncateUtf8(full, maxBytes - utf8Length(ELLIPSIS)).trimEnd() + ELLIPSIS;
}

export interface TakSendTarget {
  identityId: IdentityId;
  protocol: 'meshtastic' | 'meshcore';
  channelIndex: number;
  /** The companion a direct message goes to; unset for a channel message. */
  destination?: number;
}

/**
 * Where a TAK client's message goes out: for a channel, every radio serving it with sending
 * allowed; for a companion, the radio TAK uses for its protocol, if that radio has direct
 * messages on.
 */
export function findTakSendTargets(target: TakChatTarget): TakSendTarget[] {
  if (target.kind === 'direct') {
    const identityId = getTakRadio(target.protocol);
    if (!identityId || !getTakRelayPrefs(identityId).directMessages) return [];
    return [{ identityId, protocol: target.protocol, channelIndex: 0, destination: target.nodeId }];
  }
  return listTakServedChannels()
    .filter((c) => c.key === target.channelKey && c.send)
    .map((c) => ({ identityId: c.identityId, protocol: c.protocol, channelIndex: c.index }));
}

export type TakMeshSendFn = (target: TakSendTarget, text: string) => Promise<void>;

/** Reject when `send` has not settled within the send timeout. */
function withSendTimeout(send: Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('mesh send timed out'));
    }, TAK_MESH_SEND_TIMEOUT_MS);
    send.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Transmit one TAK client's message: on the served channel it was sent to, on every radio
 * serving that channel with sending allowed, or as a direct message to the companion it was
 * sent to. Does nothing when nothing allows it. Returns how many radios it was sent on; a
 * failed send is logged and does not stop the others.
 */
export async function relayTakChatToMesh(
  message: TAKInboundChat,
  sendFn: TakMeshSendFn,
  nowMs: number = Date.now(),
): Promise<number> {
  const targets = findTakSendTargets(message.target);
  if (targets.length === 0) return 0;
  const text = formatTakMeshText(message.senderCallsign, message.text);
  let sent = 0;
  for (const target of targets) {
    // Only a channel message is heard back off the mesh; a direct message has no echo.
    const onChannel = target.destination === undefined;
    if (onChannel) rememberTakSend(target.identityId, target.channelIndex, text, nowMs);
    try {
      await withSendTimeout(sendFn(target, text));
      sent++;
    } catch (e) {
      if (onChannel) consumeTakEcho(target.identityId, target.channelIndex, text, nowMs);
      console.warn('[TakInboundChat] mesh send failed ' + errLikeToLogString(e));
    }
  }
  return sent;
}

let relayQueue: Promise<unknown> = Promise.resolve();

/**
 * Relay messages one at a time, in the order they arrived: each message finishes on all of its
 * channels before the next starts, so the mesh sees them in TAK order. A failed or timed-out
 * message does not stop the ones queued behind it.
 */
export function enqueueTakChatRelay(
  message: TAKInboundChat,
  sendFn: TakMeshSendFn,
): Promise<number> {
  const run = relayQueue.then(() => relayTakChatToMesh(message, sendFn));
  relayQueue = run.catch(() => undefined);
  return run;
}
