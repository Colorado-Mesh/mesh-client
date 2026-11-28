import { MESHCOM_MAX_MSG_ID_LEN } from '@/shared/meshcomConstants';

export interface MeshcomLogicalMessage {
  id: string;
  from: number;
  payload: string;
  channelIndex: number;
  timestamp: number;
}

function sameLogicalMeshcomMessage(
  existing: MeshcomLogicalMessage,
  incoming: MeshcomLogicalMessage,
): boolean {
  return (
    existing.from === incoming.from &&
    existing.payload === incoming.payload &&
    existing.channelIndex === incoming.channelIndex &&
    existing.timestamp === incoming.timestamp
  );
}

/** Keep the suffix intact so later retries stay distinct after the id is capped. */
function boundedMeshcomId(base: string, suffix: string): string {
  const headRoom = MESHCOM_MAX_MSG_ID_LEN - suffix.length;
  if (headRoom <= 0) return suffix.slice(0, MESHCOM_MAX_MSG_ID_LEN);
  return `${base.slice(0, headRoom)}${suffix}`;
}

/**
 * Wire ids (`meshcom-ble-<hex>`, EXTUDP `msg_id`, outbound seq) wrap and collide.
 * Keep the id when it is new or the same logical message; otherwise mint a distinct one.
 */
export function meshcomIncomingStoreId(
  byId: Readonly<Record<string, MeshcomLogicalMessage | undefined>>,
  incoming: MeshcomLogicalMessage,
): string {
  const accept = (id: string): boolean => {
    const row = byId[id];
    return row == null || sameLogicalMeshcomMessage(row, incoming);
  };
  if (accept(incoming.id)) return incoming.id;
  for (let n = 0; n < 50; n++) {
    const suffix = n === 0 ? `~${incoming.timestamp}` : `~${incoming.timestamp}~${n}`;
    const candidate = boundedMeshcomId(incoming.id, suffix);
    if (accept(candidate)) return candidate;
  }
  return boundedMeshcomId(incoming.id, `~${incoming.timestamp}~${incoming.from}`);
}
