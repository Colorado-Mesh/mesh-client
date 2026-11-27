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

function fitMeshcomMsgId(id: string): string {
  return id.length <= MESHCOM_MAX_MSG_ID_LEN ? id : id.slice(0, MESHCOM_MAX_MSG_ID_LEN);
}

/**
 * Wire ids (`meshcom-ble-<hex>`, EXTUDP `msg_id`, outbound seq) wrap and collide.
 * Keep the id when it is new or the same logical message; otherwise mint a distinct one.
 */
export function meshcomIncomingStoreId(
  byId: Readonly<Record<string, MeshcomLogicalMessage | undefined>>,
  incoming: MeshcomLogicalMessage,
): string {
  const existing = byId[incoming.id];
  if (existing == null || sameLogicalMeshcomMessage(existing, incoming)) return incoming.id;
  const stamped = fitMeshcomMsgId(`${incoming.id}~${incoming.timestamp}`);
  const stampedRow = byId[stamped];
  if (stampedRow == null || sameLogicalMeshcomMessage(stampedRow, incoming)) return stamped;
  return fitMeshcomMsgId(`${stamped}~${incoming.from}`);
}
