/**
 * Decode Meshtastic STORE_FORWARD_PLUSPLUS_APP payloads and map chain phases
 * onto outbound chat rows via encapsulatedId.
 */
import { fromBinary } from '@bufbuild/protobuf';
import { Mesh } from '@meshtastic/protobufs';

import type { MeshtasticSfppPhase } from './meshtasticAckProof';

/** StoreForwardPlusPlus.SFPP_message_type wire values. */
const SFPP_CANON_ANNOUNCE = 0;
const SFPP_CHAIN_QUERY = 1;
const SFPP_LINK_REQUEST = 3;
const SFPP_LINK_PROVIDE = 4;
const SFPP_LINK_PROVIDE_FIRSTHALF = 5;
const SFPP_LINK_PROVIDE_SECONDHALF = 6;

export interface DecodedStoreForwardPlusPlus {
  sfppMessageType: number;
  encapsulatedId: number;
  encapsulatedFrom: number;
  encapsulatedTo: number;
  phase: MeshtasticSfppPhase;
}

/** Map SF++ message type → chat badge phase (unknown stays neutral). */
export function sfppPhaseForMessageType(type: number): MeshtasticSfppPhase {
  switch (type) {
    case SFPP_CHAIN_QUERY:
    case SFPP_LINK_REQUEST:
    case SFPP_CANON_ANNOUNCE:
      return 'routing';
    case SFPP_LINK_PROVIDE:
    case SFPP_LINK_PROVIDE_FIRSTHALF:
    case SFPP_LINK_PROVIDE_SECONDHALF:
      return 'confirmed';
    default:
      return 'unknown';
  }
}

function asUint32(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value >>> 0 : 0;
}

function asInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : -1;
}

/** Decode StoreForwardPlusPlus bytes; null when malformed or missing encapsulatedId. */
export function decodeStoreForwardPlusPlus(bytes: Uint8Array): DecodedStoreForwardPlusPlus | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- generated protobuf schema
    const schema = Mesh.StoreForwardPlusPlusSchema as Parameters<typeof fromBinary>[0];
    const msg = fromBinary(schema, bytes) as Record<string, unknown>;
    const encapsulatedId = asUint32(msg.encapsulatedId);
    if (encapsulatedId === 0) return null;
    const sfppMessageType = asInt(msg.sfppMessageType);
    return {
      sfppMessageType,
      encapsulatedId,
      encapsulatedFrom: asUint32(msg.encapsulatedFrom),
      encapsulatedTo: asUint32(msg.encapsulatedTo),
      phase: sfppPhaseForMessageType(sfppMessageType),
    };
  } catch (err) {
    console.debug('[meshtasticStoreForwardPlusPlus] malformed SF++ payload', err);
    return null;
  }
}

/**
 * Prefer a stronger phase when correlating multiple SF++ packets for one message.
 * confirmed > routing > unknown.
 */
export function mergeSfppPhase(
  previous: MeshtasticSfppPhase | undefined,
  next: MeshtasticSfppPhase,
): MeshtasticSfppPhase {
  const rank = (p: MeshtasticSfppPhase | undefined): number => {
    if (p === 'confirmed') return 3;
    if (p === 'routing') return 2;
    if (p === 'unknown') return 1;
    return 0;
  };
  return rank(next) >= rank(previous) ? next : (previous ?? next);
}
