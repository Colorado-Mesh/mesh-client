import type { MeshProtocol } from '@/shared/meshProtocol';

import {
  isGroupChannelRecord,
  type MessageRecord,
  subscribeMessageStoreEvents,
  useMessageStore,
} from '../stores/messageStore';
import { getIdentityIdForProtocol } from './identityByProtocol';
import { isBeacon, isBeaconAck } from './mecp/engine';
import { echoedAckCodes, isGeneralAck } from './mecp/mecpAck';
import { incidentPayloadMatchKey, type MecpParsed, tryParseMecp } from './mecp/mecpMessages';
import { MESHCORE_HEARD_REPEAT_WINDOW_MS } from './meshcore/heardRepeatTracker';
import { useRelayCoverageStore } from './relayCoverage/relayCoverageStore';
import { assertReticulumSendAcked, RETICULUM_RECEIPT_TIMEOUT_MS } from './reticulumOutboundReceipt';
import { resolveMeshtasticOutboundStoreKey } from './sessions/meshtasticSession';
import type { IdentityId } from './types';

/** Firmware retransmits a `wantAck` packet a few times before MAX_RETRANSMIT; leave headroom. */
export const MESHTASTIC_NETWORK_ACK_TIMEOUT_MS = 90_000;
/** Channel floods wait out the heard-repeat window; DM hop-ACK timers settle well inside it. */
export const MESHCORE_NETWORK_ACK_TIMEOUT_MS = MESHCORE_HEARD_REPEAT_WINDOW_MS + 5_000;
export const NETWORK_ACK_MAX_TIMEOUT_MS = Math.max(
  MESHTASTIC_NETWORK_ACK_TIMEOUT_MS,
  MESHCORE_NETWORK_ACK_TIMEOUT_MS,
  RETICULUM_RECEIPT_TIMEOUT_MS,
);

export const NETWORK_ACK_TIMEOUT_KEY = 'chatPanel.sendErrors.networkAckTimeout';
export const NETWORK_ACK_FAILED_KEY = 'chatPanel.sendErrors.networkAckFailed';
export const NETWORK_ACK_CANCELLED_KEY = 'chatPanel.outboxCancelled';

export function isNetworkAckCancelledError(err: unknown): boolean {
  return err instanceof Error && err.message === NETWORK_ACK_CANCELLED_KEY;
}

export function networkAckTimeoutMs(protocol: MeshProtocol): number {
  switch (protocol) {
    case 'meshtastic':
      return MESHTASTIC_NETWORK_ACK_TIMEOUT_MS;
    case 'meshcore':
      return MESHCORE_NETWORK_ACK_TIMEOUT_MS;
    case 'reticulum':
      return RETICULUM_RECEIPT_TIMEOUT_MS;
  }
}

/**
 * True when `incoming` (heard from another station) shows our MECP report reached the
 * network: an R01 echoing our codes (or severity when it echoes none), a B02 for our
 * beacon, or a relayed copy of the same payload.
 */
export function isPeerMecpNetworkAck(ours: MecpParsed, incoming: MecpParsed): boolean {
  if (ours.severity == null || incoming.severity == null) return false;
  if (isGeneralAck(incoming.codes)) {
    const echoed = echoedAckCodes(incoming.codes);
    if (echoed.length === 0) return incoming.severity === ours.severity;
    return echoed.some((c) => ours.codes.includes(c));
  }
  if (isBeaconAck(incoming.codes)) return isBeacon(ours.codes);
  return (
    incidentPayloadMatchKey({
      severity: incoming.severity,
      codes: incoming.codes,
      freetext: incoming.freetext ?? '',
    }) ===
    incidentPayloadMatchKey({
      severity: ours.severity,
      codes: ours.codes,
      freetext: ours.freetext ?? '',
    })
  );
}

type TransportVerdict = 'acked' | 'failed' | undefined;

/** Per-protocol "heard by the network" verdict for the tracked outbound record. */
export function readTransportVerdict(
  protocol: MeshProtocol,
  identityId: IdentityId,
  record: MessageRecord,
): TransportVerdict {
  if (protocol === 'meshtastic') {
    if (record.status === 'acked' || record.mqttStatus === 'acked') return 'acked';
    const deviceFailed = record.status === 'failed' || record.status == null;
    const mqttDone = record.mqttStatus == null || record.mqttStatus === 'failed';
    if (deviceFailed && mqttDone && (record.status != null || record.mqttStatus != null)) {
      return 'failed';
    }
    return undefined;
  }
  if (protocol === 'meshcore') {
    if (record.status === 'failed') return 'failed';
    if (isGroupChannelRecord(record)) {
      // Companion accept marks channel floods `acked`; only a repeater rebroadcast counts.
      const coverage = useRelayCoverageStore.getState().coverageFor(identityId, record.id);
      return (coverage?.heardRepeaters?.length ?? 0) > 0 ? 'acked' : undefined;
    }
    return record.status === 'acked' ? 'acked' : undefined;
  }
  return record.status === 'acked' ? 'acked' : record.status === 'failed' ? 'failed' : undefined;
}

function findIdentityWithMessage(
  protocol: MeshProtocol,
  messageId: string,
  preferred: IdentityId | null | undefined,
): IdentityId | null {
  const all = useMessageStore.getState().messages as Partial<
    Record<IdentityId, Record<string, MessageRecord>>
  >;
  if (preferred != null && Object.hasOwn(all[preferred] ?? {}, messageId)) return preferred;
  const byProtocol = getIdentityIdForProtocol(protocol);
  if (byProtocol != null && Object.hasOwn(all[byProtocol] ?? {}, messageId)) return byProtocol;
  for (const [identityId, bucket] of Object.entries(all)) {
    if (bucket != null && Object.hasOwn(bucket, messageId)) return identityId;
  }
  return preferred ?? byProtocol;
}

export interface AwaitNetworkAckOptions {
  protocol: MeshProtocol;
  /** Store id returned by the send fn (Meshtastic tempId, MeshCore provisional id, LXMF id). */
  sendResult: unknown;
  /** Outbound text; MECP payloads also accept peer R01/B02/relay as acknowledgement. */
  payload: string;
  identityId?: IdentityId | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Resolve once the network acknowledges an outbound message (see `docs/development/mecp.md`):
 * Meshtastic routing/implicit ACK or MQTT publish, MeshCore DM ACK or channel repeater heard,
 * Reticulum LXMF receipt, or (MECP only) a peer ACK / relay of the same report.
 * Rejects with {@link NETWORK_ACK_TIMEOUT_KEY}, {@link NETWORK_ACK_FAILED_KEY} (or the record's
 * own send error), or {@link NETWORK_ACK_CANCELLED_KEY} when `signal` aborts.
 */
export function awaitNetworkAck(opts: AwaitNetworkAckOptions): Promise<void> {
  const { protocol, payload, signal } = opts;
  const timeoutMs = opts.timeoutMs ?? networkAckTimeoutMs(protocol);
  const sendId =
    typeof opts.sendResult === 'string' && opts.sendResult !== '' ? opts.sendResult : null;
  const ours = tryParseMecp(payload);

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(NETWORK_ACK_CANCELLED_KEY));
      return;
    }
    if (sendId == null && protocol !== 'reticulum') {
      reject(new Error(NETWORK_ACK_FAILED_KEY));
      return;
    }

    const cleanups: (() => void)[] = [];
    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      for (const fn of cleanups) fn();
      if (err) reject(err);
      else resolve();
    };

    const identityId =
      sendId != null ? findIdentityWithMessage(protocol, sendId, opts.identityId) : null;
    let trackedId = sendId;
    const meshtasticTempId =
      protocol === 'meshtastic' && sendId != null ? Number.parseInt(sendId, 10) : NaN;

    const onAbort = (): void => {
      finish(new Error(NETWORK_ACK_CANCELLED_KEY));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => signal?.removeEventListener('abort', onAbort));

    if (protocol === 'reticulum') {
      assertReticulumSendAcked(identityId ?? opts.identityId ?? null, opts.sendResult, timeoutMs)
        .then(() => {
          finish();
        })
        .catch((err: unknown) => {
          finish(err instanceof Error ? err : new Error(NETWORK_ACK_FAILED_KEY));
        });
    } else {
      const timer = setTimeout(() => {
        finish(new Error(NETWORK_ACK_TIMEOUT_KEY));
      }, timeoutMs);
      cleanups.push(() => {
        clearTimeout(timer);
      });
    }

    const readTrackedRecord = (): MessageRecord | undefined => {
      if (identityId == null || trackedId == null) return undefined;
      const bucket = useMessageStore.getState().messages[identityId] as
        Record<string, MessageRecord> | undefined;
      return bucket?.[trackedId];
    };

    const evaluate = (): void => {
      if (settled || identityId == null || trackedId == null || protocol === 'reticulum') return;
      if (Number.isFinite(meshtasticTempId)) {
        trackedId = resolveMeshtasticOutboundStoreKey(meshtasticTempId, trackedId);
      }
      const record = readTrackedRecord();
      if (!record) return;
      const verdict = readTransportVerdict(protocol, identityId, record);
      if (verdict === 'acked') finish();
      else if (verdict === 'failed') finish(new Error(record.error ?? NETWORK_ACK_FAILED_KEY));
    };

    let ownSenderId: number | undefined = readTrackedRecord()?.from;

    const onPeerRecord = (record: MessageRecord): void => {
      if (settled || ours == null) return;
      if (record.id === trackedId) return;
      if (record.status === 'sending' || record.mqttStatus === 'sending') return;
      if (record.status === 'failed') return;
      ownSenderId ??= readTrackedRecord()?.from;
      if (ownSenderId != null && record.from === ownSenderId) return;
      const incoming = tryParseMecp(record.payload);
      if (incoming != null && isPeerMecpNetworkAck(ours, incoming)) finish();
    };

    cleanups.push(
      subscribeMessageStoreEvents((event) => {
        if (event.type === 'added') {
          onPeerRecord(event.record);
          return;
        }
        if (event.identityId !== identityId) return;
        if (event.fromId === trackedId) trackedId = event.toId;
        evaluate();
      }),
    );

    if (protocol !== 'reticulum') {
      cleanups.push(useMessageStore.subscribe(evaluate));
      if (protocol === 'meshcore') cleanups.push(useRelayCoverageStore.subscribe(evaluate));
      evaluate();
    }
  });
}
