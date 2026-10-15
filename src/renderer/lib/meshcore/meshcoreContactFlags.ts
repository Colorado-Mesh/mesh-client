/**
 * Per-contact flag bits on the companion's own contact table (`ContactInfo.flags`).
 * @see meshcore-dev/MeshCore examples/companion_radio/MyMesh.cpp (isRemoteCLIAllowed, v1.18)
 */
import { withTimeout } from '@/shared/withTimeout';

import { MESHCORE_CONTACT_FLAG_REMOTE_CLI } from '../meshcoreTelemetryPrivacy';
import { pubkeyToNodeId } from '../meshcoreUtils';
import { MESHCORE_ROOM_LOGIN_PATH_SYNC_TIMEOUT_MS } from '../timeConstants';
import type { MeshCoreContactRaw } from './meshcoreHookTypes';

export interface MeshcoreContactFlagConnection {
  getContacts(): Promise<MeshCoreContactRaw[]>;
  addOrUpdateContact(
    publicKey: Uint8Array,
    type: number,
    flags: number,
    outPathLen: number,
    outPath: Uint8Array,
    advName: string,
    lastAdvert: number,
    advLat: number,
    advLon: number,
  ): Promise<void>;
}

/** Set or clear `mask` in a contact flags byte, leaving every other bit untouched. */
export function withMeshcoreContactFlag(flags: number, mask: number, on: boolean): number {
  const f = flags & 0xff;
  return (on ? f | mask : f & ~mask) & 0xff;
}

export function isMeshcoreRemoteCliAllowed(flags: number | null | undefined): boolean {
  return typeof flags === 'number' && (flags & MESHCORE_CONTACT_FLAG_REMOTE_CLI) !== 0;
}

async function findRadioContact(
  conn: MeshcoreContactFlagConnection,
  nodeId: number,
): Promise<MeshCoreContactRaw | undefined> {
  const contacts = await withTimeout(
    conn.getContacts(),
    MESHCORE_ROOM_LOGIN_PATH_SYNC_TIMEOUT_MS,
    'meshcoreContactFlagsGetContacts',
  );
  return contacts.find((c) => pubkeyToNodeId(c.publicKey) === nodeId);
}

/** Flags byte of the contact on our radio, or null when it is not in the radio's table. */
export async function readMeshcoreRadioContactFlags(
  conn: MeshcoreContactFlagConnection,
  nodeId: number,
): Promise<number | null> {
  const contact = await findRadioContact(conn, nodeId);
  return contact ? contact.flags & 0xff : null;
}

/**
 * Rewrite the contact on our radio with `mask` set or cleared. Path, name, location and the other
 * flag bits are written back unchanged. Returns the new flags, or null when the contact is not on
 * the radio (nothing is written).
 */
export async function setMeshcoreRadioContactFlag(
  conn: MeshcoreContactFlagConnection,
  nodeId: number,
  mask: number,
  on: boolean,
): Promise<number | null> {
  const contact = await findRadioContact(conn, nodeId);
  if (!contact) return null;
  const flags = withMeshcoreContactFlag(contact.flags, mask, on);
  await withTimeout(
    conn.addOrUpdateContact(
      contact.publicKey,
      contact.type,
      flags,
      // -1 (0xFF on the wire) keeps an unknown path as flood rather than forcing 0-hop direct.
      contact.outPathLen ?? -1,
      contact.outPath instanceof Uint8Array ? contact.outPath : new Uint8Array(64),
      contact.advName,
      contact.lastAdvert,
      contact.advLat,
      contact.advLon,
    ),
    MESHCORE_ROOM_LOGIN_PATH_SYNC_TIMEOUT_MS,
    'meshcoreContactFlagsAddOrUpdate',
  );
  return flags;
}
