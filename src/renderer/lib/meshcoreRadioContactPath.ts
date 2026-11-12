import { meshcorePubkeyPathPrefix, meshcoreRadioContactRoute } from '../../shared/meshcorePathHash';
import type { MeshCoreContactRaw } from './meshcore/meshcoreHookTypes';
import { meshcoreStoredPathLooksLikeFullPubKey } from './meshcoreRepeaterTracePath';
import {
  MESHCORE_OUT_PATH_LEN_MAX,
  meshcoreSliceContactOutPathForTrace,
  pubkeyToNodeId,
} from './meshcoreUtils';

export interface MeshcoreRadioContactPathSnapshot {
  path: Uint8Array | undefined;
  radioContactPathLen: number | null;
  radioContactFound: boolean;
  /**
   * The contact as just read from the radio holds non-zero path bytes past its route length
   * ({@link meshcoreContactHasLeftoverPathBytes}). Absent when the radio was not read.
   */
  radioPathLeftover?: boolean;
}

/**
 * Whether a radio contact's 64-byte path buffer holds bytes past the route its length byte
 * gives. Firmware replaces a route with `copyPath` and never clears the rest, and
 * CMD_RESET_PATH only changes the length, so a contact once reached through relays keeps their
 * hashes there after the radio hears it direct or forgets its route. When the length byte gives
 * no route (0xFF), the radio claims none of the buffer, so any non-zero byte is left over; a
 * contact the radio never routed has a clean buffer.
 */
export function meshcoreContactHasLeftoverPathBytes(
  contact: Pick<MeshCoreContactRaw, 'outPath' | 'outPathLen'>,
): boolean {
  if (!(contact.outPath instanceof Uint8Array)) return false;
  const len = contact.outPathLen;
  if (typeof len !== 'number' || !Number.isFinite(len)) return false;
  const route = meshcoreRadioContactRoute(len);
  const routeBytes = route ? route.hopCount * route.hashSizeBytes : 0;
  return contact.outPath.subarray(routeBytes).some((byte) => byte !== 0);
}

/** Slice contact outPath for trace/ping, including outPathLen===0 fallback. */
export function meshcoreContactOutPathBytesForTrace(contact: MeshCoreContactRaw): Uint8Array {
  let slice = meshcoreSliceContactOutPathForTrace(contact.outPath, contact.outPathLen);
  if (slice.length <= 1 && contact.outPathLen === 0) {
    slice = meshcoreSliceContactOutPathForTrace(contact.outPath, undefined);
  }
  if (meshcoreStoredPathLooksLikeFullPubKey(slice, contact.publicKey)) {
    const len = contact.outPathLen;
    const radioSaysMultiHop =
      len != null && Number.isFinite(len) && len >= 1 && len <= MESHCORE_OUT_PATH_LEN_MAX;
    if (radioSaysMultiHop) {
      return meshcorePubkeyPathPrefix(contact.publicKey, 1);
    }
    return new Uint8Array(0);
  }
  return slice;
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
  let radioPathLeftover: boolean | undefined;

  for (const contact of contacts) {
    if (pubkeyToNodeId(contact.publicKey) !== nodeId) continue;
    radioContactFound = true;
    if (typeof contact.outPathLen === 'number' && Number.isFinite(contact.outPathLen)) {
      radioContactPathLen = contact.outPathLen;
    }
    radioPathLeftover = meshcoreContactHasLeftoverPathBytes(contact);
    const slice = meshcoreContactOutPathBytesForTrace(contact);
    if (slice.length > 0) {
      path = slice;
    }
    break;
  }

  return { path, radioContactPathLen, radioContactFound, radioPathLeftover };
}
