/**
 * MeshCom firmware outbound message id layout (ICSSW MeshCom-Firmware `loop_functions.cpp`,
 * `msgid_counter.h`): `msg_id = ((gwId & 0x3FFFFF) << 10) | (seq & 0x3FF)`.
 */

const MESHCOM_MSG_SEQ_MASK = 0x3ff;
const MESHCOM_GW_ID_PREFIX_MASK = 0x3fffff;

/** Fold 0..999 like firmware `msgIdAdvance` / `kMsgIdMax`. */
export function meshcomMsgIdAdvance(current: number): number {
  const next = current + 1;
  return next > 999 ? next % 1000 : next;
}

export function composeMeshcomFirmwareMsgId(gwIdPrefix: number, seq: number): number {
  return (((gwIdPrefix & MESHCOM_GW_ID_PREFIX_MASK) << 10) | (seq & MESHCOM_MSG_SEQ_MASK)) >>> 0;
}

export function meshcomMsgSeqFromId(msgId: number): number {
  return msgId & MESHCOM_MSG_SEQ_MASK;
}

export function meshcomGwPrefixFromId(msgId: number): number {
  return (msgId >>> 10) & MESHCOM_GW_ID_PREFIX_MASK;
}

/**
 * Whether a routing ACK `requestId` settles an outbound row keyed by `outboundPacketId`.
 * Peer KISS `ackNN` carries the low `{NNN}` suffix; BLE phone ACKs carry the full firmware id.
 */
export function meshcomRoutingAckMatchesOutbound(
  outboundPacketId: number,
  requestId: number,
  knownGwPrefix?: number | null,
): boolean {
  const out = outboundPacketId >>> 0;
  const req = requestId >>> 0;
  if (out === req) return true;
  const outSeq = meshcomMsgSeqFromId(out);
  const reqSeq = meshcomMsgSeqFromId(req);
  if (outSeq !== reqSeq) return false;
  const outPrefix = meshcomGwPrefixFromId(out);
  const reqPrefix = meshcomGwPrefixFromId(req);
  if (outPrefix !== 0 && outPrefix === reqPrefix) return true;
  if (out <= 999 && req > 999 && knownGwPrefix != null) {
    const gw = knownGwPrefix & MESHCOM_GW_ID_PREFIX_MASK;
    return reqPrefix === gw;
  }
  if (out > 999 && req <= 999) return true;
  if (out <= 999 && req <= 999) return true;
  return false;
}
