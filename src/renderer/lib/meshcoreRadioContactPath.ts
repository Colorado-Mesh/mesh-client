import type { MeshCoreContactRaw } from './meshcore/meshcoreHookTypes';
import { meshcoreStoredPathLooksLikeFullPubKey } from './meshcoreRepeaterTracePath';
import { meshcoreSliceContactOutPathForTrace, pubkeyToNodeId } from './meshcoreUtils';

export interface MeshcoreRadioContactPathSnapshot {
  path: Uint8Array | undefined;
  radioContactPathLen: number | null;
  radioContactFound: boolean;
}

/** Resolve outbound path bytes from companion contact list for repeater RPC / trace. */
export function meshcoreSnapshotContactPathFromContacts(
  nodeId: number,
  contacts: readonly MeshCoreContactRaw[],
  existingPath?: Uint8Array,
): MeshcoreRadioContactPathSnapshot {
  let radioContactPathLen: number | null = null;
  let radioContactFound = false;
  let path = existingPath;

  for (const contact of contacts) {
    if (pubkeyToNodeId(contact.publicKey) !== nodeId) continue;
    radioContactFound = true;
    if (typeof contact.outPathLen === 'number' && Number.isFinite(contact.outPathLen)) {
      radioContactPathLen = contact.outPathLen;
    }
    let slice = meshcoreSliceContactOutPathForTrace(contact.outPath, contact.outPathLen);
    if (slice.length <= 1 && contact.outPathLen === 0) {
      slice = meshcoreSliceContactOutPathForTrace(contact.outPath, undefined);
    }
    if (meshcoreStoredPathLooksLikeFullPubKey(slice, contact.publicKey)) {
      slice = new Uint8Array(0);
    }
    if (slice.length > 0) {
      path = slice;
    }
    break;
  }

  return { path, radioContactPathLen, radioContactFound };
}
