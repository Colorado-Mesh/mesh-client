import type { TAKInboundChat } from '@/shared/tak-types';

import { useIdentityStore } from '../../stores/identityStore';
import { getTakRelayPrefs } from '../../stores/takRelayPrefsStore';
import { errLikeToLogString } from '../errLikeToLogString';
import type { IdentityId } from '../types';
import { consumeTakEcho, rememberTakSend } from './takEchoGuard';

/**
 * UTF-8 budget for one mesh message sent on behalf of a TAK client, callsign prefix included.
 * Conservative for both protocols: a MeshCore channel message also carries the sender name.
 */
export const TAK_MESH_SEND_MAX_BYTES = 160;
const ELLIPSIS = '…';

const encoder = new TextEncoder();

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
}

/** Channels bridged to `room` whose identity opted in to sending. Room names match exactly. */
export function findTakSendTargets(room: string): TakSendTarget[] {
  const targets: TakSendTarget[] = [];
  for (const identity of Object.values(useIdentityStore.getState().identities)) {
    const protocol = identity.protocol.type;
    if (protocol !== 'meshtastic' && protocol !== 'meshcore') continue;
    const prefs = getTakRelayPrefs(identity.id);
    for (const channelIndex of prefs.chatSendChannels) {
      if (prefs.chatBridges[channelIndex] === room) {
        targets.push({ identityId: identity.id, protocol, channelIndex });
      }
    }
  }
  return targets;
}

export type TakMeshSendFn = (target: TakSendTarget, text: string) => Promise<void>;

/**
 * Transmit one TAK client's GeoChat message on every mesh channel bridged to its room that
 * allows sending. Does nothing for a room no channel opted in for. Returns how many channels it
 * was sent on; a failed send is logged and does not stop the others.
 */
export async function relayTakChatToMesh(
  message: TAKInboundChat,
  sendFn: TakMeshSendFn,
  nowMs: number = Date.now(),
): Promise<number> {
  const targets = findTakSendTargets(message.room);
  if (targets.length === 0) return 0;
  const text = formatTakMeshText(message.senderCallsign, message.text);
  let sent = 0;
  for (const target of targets) {
    rememberTakSend(target.identityId, target.channelIndex, text, nowMs);
    try {
      await sendFn(target, text);
      sent++;
    } catch (e) {
      consumeTakEcho(target.identityId, target.channelIndex, text, nowMs);
      console.warn('[TakInboundChat] mesh send failed ' + errLikeToLogString(e));
    }
  }
  return sent;
}
