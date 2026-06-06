import { meshcoreMessageDedupeKey } from '../hooks/meshcore/meshcoreHookPreamble';
import type { ChatMessage, IdentityId } from './types';

/** identityId → dedupeKey → store message id */
const dedupeIndex = new Map<IdentityId, Map<string, string>>();

function bucketFor(identityId: IdentityId): Map<string, string> {
  let bucket = dedupeIndex.get(identityId);
  if (!bucket) {
    bucket = new Map();
    dedupeIndex.set(identityId, bucket);
  }
  return bucket;
}

export function lookupMeshcoreMessageIdByDedupeKey(
  identityId: IdentityId,
  dedupeKey: string,
): string | undefined {
  return dedupeIndex.get(identityId)?.get(dedupeKey);
}

export function indexMeshcoreMessageForDedupe(
  identityId: IdentityId,
  msg: ChatMessage,
  messageId: string,
): void {
  bucketFor(identityId).set(meshcoreMessageDedupeKey(msg), messageId);
}

export function removeMeshcoreDedupeIndexForMessage(
  identityId: IdentityId,
  msg: ChatMessage,
): void {
  dedupeIndex.get(identityId)?.delete(meshcoreMessageDedupeKey(msg));
}

export function clearMeshcoreDedupeIndex(identityId: IdentityId): void {
  dedupeIndex.delete(identityId);
}

export function meshcoreDedupeIndexSize(identityId: IdentityId): number {
  return dedupeIndex.get(identityId)?.size ?? 0;
}

/** Rebuild index after bulk hydration (O(n) once vs O(n) per ingest). */
export function rebuildMeshcoreDedupeIndex(
  identityId: IdentityId,
  entries: { id: string; message: ChatMessage }[],
): void {
  const bucket = new Map<string, string>();
  for (const { id, message } of entries) {
    bucket.set(meshcoreMessageDedupeKey(message), id);
  }
  dedupeIndex.set(identityId, bucket);
}
