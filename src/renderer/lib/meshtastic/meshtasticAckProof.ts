/**
 * Meshtastic MeshPacket.ackProofStatus helpers for chat delivery badges.
 * Unknown / future enum values stay neutral — never labeled as proven delivery.
 */

export type MeshtasticAckProofStatus = 'absent' | 'valid' | 'invalid' | 'no_key' | 'unknown';

export type MeshtasticSfppPhase = 'routing' | 'confirmed' | 'unknown';

/** MeshPacket.AckProofStatus wire values (protobufs 2.8.2). */
const ACK_PROOF_ABSENT = 0;
const ACK_PROOF_VALID = 1;
const ACK_PROOF_INVALID = 2;
const ACK_PROOF_NO_KEY = 3;

/** Normalize a protobuf / wire ackProofStatus value for MessageRecord storage. */
export function normalizeAckProofStatus(raw: unknown): MeshtasticAckProofStatus {
  if (raw === ACK_PROOF_ABSENT || raw === 'ACK_PROOF_ABSENT') return 'absent';
  if (raw === ACK_PROOF_VALID || raw === 'ACK_PROOF_VALID') return 'valid';
  if (raw === ACK_PROOF_INVALID || raw === 'ACK_PROOF_INVALID') return 'invalid';
  if (raw === ACK_PROOF_NO_KEY || raw === 'ACK_PROOF_NO_KEY') return 'no_key';
  if (raw == null) return 'absent';
  return 'unknown';
}

/** True only for firmware-verified recipient receipts. */
export function isAckProofProven(status: MeshtasticAckProofStatus | undefined): boolean {
  return status === 'valid';
}

/** Badge i18n key suffix under `messageStatusBadge.ackProof.*`. */
export function ackProofBadgeKey(
  status: MeshtasticAckProofStatus | undefined,
  messageStatus: 'sending' | 'acked' | 'failed' | 'queued' | 'blocked' | undefined,
): 'proven' | 'failed' | 'relayedUnproven' | 'noKey' | 'unknown' | null {
  if (messageStatus !== 'acked') return null;
  // Undefined means the protocol did not report proof (non-Meshtastic / legacy) — keep
  // the ordinary delivered badge. Explicit ABSENT is "acked but unproven".
  if (status == null) return null;
  if (status === 'valid') return 'proven';
  if (status === 'invalid') return 'failed';
  if (status === 'absent') return 'relayedUnproven';
  if (status === 'no_key') return 'noKey';
  return 'unknown';
}
