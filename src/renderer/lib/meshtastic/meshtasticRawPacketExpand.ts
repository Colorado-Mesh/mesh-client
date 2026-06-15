import { fromBinary } from '@bufbuild/protobuf';
import { Mesh } from '@meshtastic/protobufs';

import { meshtasticComputedRfHopsAway } from '../meshtasticRfHops';

export type MeshtasticRawPacketExpandPayloadCase = 'decoded' | 'encrypted' | 'unknown';

export interface MeshtasticRawPacketExpandOk {
  ok: true;
  id: number | null;
  to: number | null;
  channel: number | null;
  hopStart: number | null;
  hopLimit: number | null;
  hopsAway: number | undefined;
  payloadCase: MeshtasticRawPacketExpandPayloadCase;
}

export type MeshtasticRawPacketExpandResult = MeshtasticRawPacketExpandOk | { ok: false };

function meshPacketPayloadCase(
  payloadVariant: { case?: string } | undefined,
): MeshtasticRawPacketExpandPayloadCase {
  const c = payloadVariant?.case;
  if (c === 'decoded' || c === 'encrypted') return c;
  return 'unknown';
}

/**
 * Decode serialized MeshPacket bytes for Sniffer expanded-row details.
 * Failure point: corrupt or truncated raw bytes — returns `{ ok: false }`; UI shows hex only.
 */
export function parseMeshtasticRawPacketExpand(
  raw: Uint8Array,
  opts?: { viaMqtt?: boolean },
): MeshtasticRawPacketExpandResult {
  try {
    const packet = fromBinary(Mesh.MeshPacketSchema, raw) as {
      id?: number;
      to?: number;
      channel?: number;
      hopStart?: number;
      hopLimit?: number;
      viaMqtt?: boolean;
      payloadVariant?: { case?: string };
    };
    const hopStart = packet.hopStart ?? null;
    const hopLimit = packet.hopLimit ?? null;
    const hopsAway = meshtasticComputedRfHopsAway({
      hopStart: hopStart ?? undefined,
      hopLimit: hopLimit ?? undefined,
      viaMqtt: opts?.viaMqtt ?? packet.viaMqtt === true,
    });
    return {
      ok: true,
      id: typeof packet.id === 'number' && Number.isFinite(packet.id) ? packet.id >>> 0 : null,
      to: typeof packet.to === 'number' && Number.isFinite(packet.to) ? packet.to >>> 0 : null,
      channel:
        typeof packet.channel === 'number' && Number.isFinite(packet.channel)
          ? packet.channel
          : null,
      hopStart,
      hopLimit,
      hopsAway,
      payloadCase: meshPacketPayloadCase(packet.payloadVariant),
    };
  } catch {
    // catch-no-log-ok corrupt MeshPacket bytes; Sniffer falls back to hex-only expanded row
    return { ok: false };
  }
}

function formatMeshtasticNodeNum(nodeNum: number): string {
  return `0x${(nodeNum >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

const MESHTASTIC_BROADCAST = 0xffffffff;

/** Debug line for expanded Sniffer row (id, to, channel, payload case). */
export function formatMeshtasticRawPacketExpandDebugLine(
  parsed: MeshtasticRawPacketExpandOk,
): string {
  const parts: string[] = [];
  if (parsed.id != null) parts.push(`id=${formatMeshtasticNodeNum(parsed.id)}`);
  if (parsed.to != null) {
    parts.push(
      parsed.to === MESHTASTIC_BROADCAST
        ? 'to=BROADCAST'
        : `to=${formatMeshtasticNodeNum(parsed.to)}`,
    );
  }
  if (parsed.channel != null) parts.push(`channel=${parsed.channel}`);
  parts.push(`payload=${parsed.payloadCase}`);
  return parts.join(' ');
}

export { MESHTASTIC_BROADCAST };
