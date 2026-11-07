/**
 * Deliver one scheduled-broadcast slot to its enabled targets.
 *
 * Single packet only: text longer than a target's single-message limit is rejected with
 * `text-too-long` — this module never calls `splitChatMessage` or sends multi-part.
 * Targets are fanned out sequentially (`SCHEDULED_BROADCAST_TARGET_GAP_MS` apart) under a
 * `SCHEDULED_BROADCAST_RUN_MAX_MS` cap; targets not reached are reported as `deferred`.
 */
import type {
  ScheduledBroadcastRow,
  ScheduledBroadcastRunOutcome,
  ScheduledBroadcastTarget,
  ScheduledBroadcastTargetResult,
} from '@/shared/scheduledBroadcastTypes';

import { getConnection } from '../../stores/connectionStore';
import { getIdentity } from '../../stores/identityStore';
import { type NodeRecord, useNodeStore } from '../../stores/nodeStore';
import { useRrcSessionStore } from '../../stores/rrcSessionStore';
import {
  countMessageWireBytes,
  getComposerPayloadLimit,
  getMeshcoreRoomPayloadLimit,
  MESHCORE_MAX_NAME_LEN,
} from '../chatComposerLimits';
import { withChatOutboxDrainLock } from '../chatOutboxDrain';
import { errLikeToLogString } from '../errLikeToLogString';
import { recordMeshcoreSend } from '../meshcoreSendRateNotice';
import { withMeshtasticTextSendPacing } from '../meshtasticTextSendPacing';
import { type RrcSendArgs, rrcSendBounded, type RrcSendResult } from '../rrc/rrcSendBounded';
import { isRrcDeadSessionSendError } from '../rrcErrorHumanize';
import { resolveRrcMsgBodyLimit } from '../rrcHubLimits';
import { rrcRoomsMatch } from '../rrcRoomName';
import { type ChatSendRequest, sendChatOnIdentity } from '../sendChatOnIdentity';
import type { IdentityId, MeshProtocol } from '../types';
import { waitForChatSettlement } from './chatSettlement';
import {
  SCHEDULED_BROADCAST_CHAT_SETTLE_TIMEOUT_MS,
  SCHEDULED_BROADCAST_RUN_MAX_MS,
  SCHEDULED_BROADCAST_TARGET_GAP_MS,
} from './constants';

export type ScheduledBroadcastFailReason =
  | 'not-connected'
  | 'text-too-long'
  | 'deferred'
  | 'room-unknown'
  | 'room-login-required'
  | 'rrc-not-connected'
  | 'send-failed';

/** Run-level reasons (no per-target result exists). */
export type ScheduledBroadcastRunReason = 'no-targets' | 'empty-text';

export interface DeliverResult {
  outcome: Exclude<ScheduledBroadcastRunOutcome, 'missed'>;
  targets: ScheduledBroadcastTargetResult[];
  /** Set only when `targets` is empty. */
  reason?: ScheduledBroadcastRunReason;
}

export interface RrcHubRoomState {
  /** Hub session is `active`. */
  active: boolean;
  /** Room is currently joined on that hub. */
  joined: boolean;
  /** Hub-advertised `max_msg_body_bytes`, when known. */
  maxMsgBodyBytes?: number | null;
}

export interface DeliverDeps {
  sendChat: (identityId: IdentityId, request: ChatSendRequest) => string | undefined;
  waitForSettlement: (
    identityId: IdentityId,
    messageId: string,
    timeoutMs: number,
  ) => Promise<boolean>;
  /** MeshCore room post (runtime `sendRoomPost`). Missing → `send-failed`. */
  sendRoomPost?: (roomNodeId: number, text: string) => Promise<void>;
  sendRrc: (args: RrcSendArgs) => Promise<RrcSendResult>;
  getRrcHubRoomState: (hubDestHash: string, room: string) => RrcHubRoomState;
  joinRrcRoom: (hubDestHash: string, room: string) => Promise<{ ok: boolean }>;
  isIdentityConnected: (identityId: IdentityId) => boolean;
  /** Resolve a MeshCore room's live node id from the node store; undefined when unknown. */
  resolveRoomNodeId: (identityId: IdentityId, roomPubKeyHex: string) => number | undefined;
  /** Wire sender name used to size the MeshCore channel `Name: ` prefix. */
  getSenderDisplayName: (identityId: IdentityId) => string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  gapMs: number;
  runMaxMs: number;
  settleTimeoutMs: number;
}

/** The identity's known nodes; either level of the lookup can miss. */
function nodesOf(identityId: IdentityId): Record<number, NodeRecord | undefined> | undefined {
  return useNodeStore.getState().nodes[identityId];
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function defaultResolveRoomNodeId(
  identityId: IdentityId,
  roomPubKeyHex: string,
): number | undefined {
  const nodes = nodesOf(identityId);
  if (!nodes) return undefined;
  const want = roomPubKeyHex.toLowerCase();
  for (const node of Object.values(nodes)) {
    if (!node) continue;
    const hex = node.publicKey ? toHex(node.publicKey) : node.publicKeyHex?.toLowerCase();
    if (hex === want) return node.nodeId;
  }
  return undefined;
}

function defaultGetSenderDisplayName(identityId: IdentityId): string {
  const identity = getIdentity(identityId);
  const selfNum = identity?.selfNodeNum ?? getConnection(identityId)?.myNodeNum;
  const selfNode = selfNum ? nodesOf(identityId)?.[selfNum] : undefined;
  return (selfNode?.longName ?? identity?.displayName ?? '').trim();
}

function defaultIsIdentityConnected(identityId: IdentityId): boolean {
  const conn = getConnection(identityId);
  if (!conn) return false;
  if (conn.status === 'connected' || conn.status === 'configured') return true;
  // Meshtastic can send over MQTT alone (sendChatOnIdentity handles the no-handle case).
  return getIdentity(identityId)?.protocol.type === 'meshtastic' && conn.mqttStatus === 'connected';
}

function defaultGetRrcHubRoomState(hubDestHash: string, room: string): RrcHubRoomState {
  const session = useRrcSessionStore.getState().sessionsByHub.get(hubDestHash.toLowerCase());
  if (!session) return { active: false, joined: false };
  return {
    active: session.status === 'active',
    joined: [...session.rooms.keys()].some((k) => rrcRoomsMatch(k, room)),
    maxMsgBodyBytes: session.limits.max_msg_body_bytes,
  };
}

export function createDefaultDeliverDeps(): DeliverDeps {
  return {
    sendChat: sendChatOnIdentity,
    waitForSettlement: waitForChatSettlement,
    sendRrc: rrcSendBounded,
    getRrcHubRoomState: defaultGetRrcHubRoomState,
    joinRrcRoom: (hubDestHash, room) =>
      window.electronAPI.reticulum.rrc.join({ hub_dest_hash: hubDestHash, room }),
    isIdentityConnected: defaultIsIdentityConnected,
    resolveRoomNodeId: defaultResolveRoomNodeId,
    getSenderDisplayName: defaultGetSenderDisplayName,
    now: () => Date.now(),
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
    gapMs: SCHEDULED_BROADCAST_TARGET_GAP_MS,
    runMaxMs: SCHEDULED_BROADCAST_RUN_MAX_MS,
    settleTimeoutMs: SCHEDULED_BROADCAST_CHAT_SETTLE_TIMEOUT_MS,
  };
}

function drainProtocolFor(target: ScheduledBroadcastTarget): MeshProtocol {
  switch (target.kind) {
    case 'meshtastic-channel':
      return 'meshtastic';
    case 'meshcore-channel':
    case 'meshcore-room':
      return 'meshcore';
    case 'rrc-room':
      return 'reticulum';
  }
}

type Attempt = { ok: true } | { ok: false; reason: ScheduledBroadcastFailReason };

const OK: Attempt = { ok: true };
const fail = (reason: ScheduledBroadcastFailReason): Attempt => ({ ok: false, reason });

async function sendChannel(
  target: ScheduledBroadcastTarget,
  text: string,
  deps: DeliverDeps,
): Promise<Attempt> {
  const { identityId } = target;
  const isMeshtastic = target.kind === 'meshtastic-channel';
  if (target.channelIndex == null) return fail('send-failed');
  if (!deps.isIdentityConnected(identityId)) return fail('not-connected');

  const limit = isMeshtastic
    ? getComposerPayloadLimit({ protocol: 'meshtastic' })
    : getComposerPayloadLimit({
        protocol: 'meshcore',
        composerContext: 'channel',
        // Unknown name → reserve the maximum so a long name can never overflow the wire.
        senderDisplayName:
          deps.getSenderDisplayName(identityId) || 'x'.repeat(MESHCORE_MAX_NAME_LEN),
      });
  if (countMessageWireBytes(text) > limit) return fail('text-too-long');

  const request: ChatSendRequest = { text, channelIndex: target.channelIndex };
  const send = (): string | undefined => deps.sendChat(identityId, request);
  const messageId = isMeshtastic ? await withMeshtasticTextSendPacing(send) : send();
  if (messageId == null) return fail('send-failed');

  const ok = await deps.waitForSettlement(identityId, messageId, deps.settleTimeoutMs);
  if (!ok) return fail('send-failed');
  if (!isMeshtastic) recordMeshcoreSend(deps.now());
  return OK;
}

async function sendMeshcoreRoom(
  target: ScheduledBroadcastTarget,
  text: string,
  deps: DeliverDeps,
): Promise<Attempt> {
  const { identityId } = target;
  if (!deps.isIdentityConnected(identityId)) return fail('not-connected');
  if (!target.roomPubKeyHex) return fail('room-unknown');
  const roomNodeId = deps.resolveRoomNodeId(identityId, target.roomPubKeyHex);
  if (roomNodeId == null) return fail('room-unknown');
  if (countMessageWireBytes(text) > getMeshcoreRoomPayloadLimit()) return fail('text-too-long');
  if (!deps.sendRoomPost) return fail('send-failed');
  try {
    await deps.sendRoomPost(roomNodeId, text);
  } catch (e: unknown) {
    const msg = errLikeToLogString(e);
    if (msg.includes('Room session expired')) return fail('room-login-required');
    console.debug('[scheduledBroadcasts] room post failed ' + msg);
    return fail('send-failed');
  }
  recordMeshcoreSend(deps.now());
  return OK;
}

async function sendRrcRoom(
  target: ScheduledBroadcastTarget,
  text: string,
  deps: DeliverDeps,
): Promise<Attempt> {
  const { hubDestHash, room } = target;
  if (!hubDestHash || !room) return fail('rrc-not-connected');

  let state = deps.getRrcHubRoomState(hubDestHash, room);
  if (!state.active || !state.joined) {
    // One join attempt; the hub session must be active and the room joined afterwards.
    let joined = false;
    try {
      joined = (await deps.joinRrcRoom(hubDestHash, room)).ok;
    } catch (e: unknown) {
      console.debug('[scheduledBroadcasts] rrc join failed ' + errLikeToLogString(e));
    }
    state = deps.getRrcHubRoomState(hubDestHash, room);
    if (!joined || !state.active) return fail('rrc-not-connected');
  }

  const bodyLimit = resolveRrcMsgBodyLimit(state.maxMsgBodyBytes);
  if (countMessageWireBytes(text) > bodyLimit) return fail('text-too-long');

  try {
    // The hub echoes our line back through the normal RRC listener (own lines are not
    // counted unread), so no local history append happens here — same as RrcPanel's room send.
    const res = await deps.sendRrc({ hub_dest_hash: hubDestHash, room, body: text, type: 'msg' });
    if (res.ok) return OK;
    const err = res.error ?? '';
    return fail(isRrcDeadSessionSendError(err) ? 'rrc-not-connected' : 'send-failed');
  } catch (e: unknown) {
    const msg = errLikeToLogString(e);
    console.debug('[scheduledBroadcasts] rrc send failed ' + msg);
    return fail(isRrcDeadSessionSendError(msg) ? 'rrc-not-connected' : 'send-failed');
  }
}

async function deliverToTarget(
  target: ScheduledBroadcastTarget,
  text: string,
  deps: DeliverDeps,
): Promise<Attempt> {
  try {
    return await withChatOutboxDrainLock(drainProtocolFor(target), async () => {
      switch (target.kind) {
        case 'meshtastic-channel':
        case 'meshcore-channel':
          return sendChannel(target, text, deps);
        case 'meshcore-room':
          return sendMeshcoreRoom(target, text, deps);
        case 'rrc-room':
          return sendRrcRoom(target, text, deps);
      }
    });
  } catch (e: unknown) {
    console.debug('[scheduledBroadcasts] target send threw ' + errLikeToLogString(e));
    return fail('send-failed');
  }
}

function summarize(results: ScheduledBroadcastTargetResult[]): DeliverResult['outcome'] {
  const okCount = results.filter((r) => r.ok).length;
  if (okCount === results.length) return 'sent';
  if (okCount > 0) return 'partial';
  // Nothing went on air: only "couldn't try" reasons → skipped; any real attempt failure → failed.
  const attempted = results.some(
    (r) =>
      r.reason !== 'not-connected' && r.reason !== 'deferred' && r.reason !== 'rrc-not-connected',
  );
  return attempted ? 'failed' : 'skipped';
}

/** Deliver `slot.text` to every enabled target. Never throws. */
export async function deliverScheduledBroadcast(
  slot: Pick<ScheduledBroadcastRow, 'text' | 'targets'>,
  overrides: Partial<DeliverDeps> = {},
): Promise<DeliverResult> {
  const deps: DeliverDeps = { ...createDefaultDeliverDeps(), ...overrides };
  const targets = slot.targets.filter((t) => t.enabled);
  if (targets.length === 0) return { outcome: 'skipped', targets: [], reason: 'no-targets' };
  const text = slot.text.trim();
  if (text.length === 0) return { outcome: 'skipped', targets: [], reason: 'empty-text' };

  const startedAt = deps.now();
  const results: ScheduledBroadcastTargetResult[] = [];
  const record = (t: ScheduledBroadcastTarget, attempt: Attempt): void => {
    results.push({
      kind: t.kind,
      label: t.label,
      ok: attempt.ok,
      ...(attempt.ok ? {} : { reason: attempt.reason }),
    });
  };

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (i > 0) {
      await deps.sleep(deps.gapMs);
    }
    if (deps.now() - startedAt >= deps.runMaxMs) {
      for (const rest of targets.slice(i)) record(rest, fail('deferred'));
      break;
    }
    record(target, await deliverToTarget(target, text, deps));
  }
  return { outcome: summarize(results), targets: results };
}
