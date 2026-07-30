/** Shape of one entry from getWaitingMessages / syncNextMessage. */
export interface MeshcoreWaitingMessageItem {
  contactMessage?: {
    pubKeyPrefix: Uint8Array;
    senderTimestamp: number;
    text: string;
    txtType?: number;
    /** Companion pathLen when present (0xFF = direct). */
    pathLen?: number;
  };
  channelMessage?: {
    channelIdx: number;
    senderTimestamp: number;
    text: string;
    /** Companion pathLen when present (0xFF = direct). */
    pathLen?: number;
  };
}

export function isMeshcoreWaitingMessageItem(value: unknown): value is MeshcoreWaitingMessageItem {
  if (value == null || typeof value !== 'object') return false;
  const rec = value as MeshcoreWaitingMessageItem;
  return rec.contactMessage != null || rec.channelMessage != null;
}

/** True when syncNextMessage returned no more queued messages. */
export function isMeshcoreWaitingQueueEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return !isMeshcoreWaitingMessageItem(value);
}

/** Normalize syncNextMessage / getWaitingMessages payload to a single item or null. */
export function normalizeMeshcoreWaitingMessageItem(
  value: unknown,
): MeshcoreWaitingMessageItem | null {
  if (isMeshcoreWaitingQueueEmpty(value)) return null;
  if (Array.isArray(value)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- External SDK value is validated by surrounding boundary logic.
    const first = value[0];
    return isMeshcoreWaitingMessageItem(first) ? first : null;
  }
  return isMeshcoreWaitingMessageItem(value) ? value : null;
}

export function normalizeMeshcoreWaitingMessageBatch(value: unknown): MeshcoreWaitingMessageItem[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter(isMeshcoreWaitingMessageItem);
  }
  const one = normalizeMeshcoreWaitingMessageItem(value);
  return one ? [one] : [];
}
