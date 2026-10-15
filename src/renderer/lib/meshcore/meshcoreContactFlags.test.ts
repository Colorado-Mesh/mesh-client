import { describe, expect, it, vi } from 'vitest';

import {
  MESHCORE_CONTACT_FLAG_REMOTE_CLI,
  MESHCORE_CONTACT_FLAG_TELEM_BASE,
} from '../meshcoreTelemetryPrivacy';
import { pubkeyToNodeId } from '../meshcoreUtils';
import {
  isMeshcoreRemoteCliAllowed,
  type MeshcoreContactFlagConnection,
  readMeshcoreRadioContactFlags,
  setMeshcoreRadioContactFlag,
  withMeshcoreContactFlag,
} from './meshcoreContactFlags';
import type { MeshCoreContactRaw } from './meshcoreHookTypes';

function makeContact(seed: number, flags: number, outPathLen?: number): MeshCoreContactRaw {
  const publicKey = new Uint8Array(32);
  publicKey[0] = seed;
  publicKey[1] = 0xab;
  const outPath = new Uint8Array(64);
  outPath[0] = 0x12;
  return {
    publicKey,
    type: 1,
    advName: `peer-${seed}`,
    lastAdvert: 1_700_000_000,
    advLat: 39_700_000,
    advLon: -104_900_000,
    flags,
    ...(outPathLen !== undefined ? { outPathLen, outPath } : {}),
  };
}

function makeConn(contacts: MeshCoreContactRaw[]) {
  const addOrUpdateContact = vi.fn(() => Promise.resolve());
  const conn: MeshcoreContactFlagConnection = {
    getContacts: () => Promise.resolve(contacts),
    addOrUpdateContact,
  };
  return { conn, addOrUpdateContact };
}

describe('withMeshcoreContactFlag', () => {
  it('sets and clears only the requested bit', () => {
    const base = 0x01 | MESHCORE_CONTACT_FLAG_TELEM_BASE;
    expect(withMeshcoreContactFlag(base, MESHCORE_CONTACT_FLAG_REMOTE_CLI, true)).toBe(0x13);
    expect(withMeshcoreContactFlag(0x13, MESHCORE_CONTACT_FLAG_REMOTE_CLI, false)).toBe(base);
    expect(withMeshcoreContactFlag(0x13, MESHCORE_CONTACT_FLAG_REMOTE_CLI, true)).toBe(0x13);
  });

  it('stays within one byte', () => {
    expect(withMeshcoreContactFlag(0x1ff, MESHCORE_CONTACT_FLAG_REMOTE_CLI, false)).toBe(0xef);
  });
});

describe('isMeshcoreRemoteCliAllowed', () => {
  it('reads flag 0x10', () => {
    expect(isMeshcoreRemoteCliAllowed(0x10)).toBe(true);
    expect(isMeshcoreRemoteCliAllowed(0x0f)).toBe(false);
    expect(isMeshcoreRemoteCliAllowed(null)).toBe(false);
  });
});

describe('setMeshcoreRadioContactFlag', () => {
  it('rewrites the contact with the new flag and every other field unchanged', async () => {
    const contact = makeContact(3, 0x03, 2);
    const { conn, addOrUpdateContact } = makeConn([makeContact(9, 0), contact]);
    const flags = await setMeshcoreRadioContactFlag(
      conn,
      pubkeyToNodeId(contact.publicKey),
      MESHCORE_CONTACT_FLAG_REMOTE_CLI,
      true,
    );
    expect(flags).toBe(0x13);
    expect(addOrUpdateContact).toHaveBeenCalledWith(
      contact.publicKey,
      1,
      0x13,
      2,
      contact.outPath,
      'peer-3',
      1_700_000_000,
      39_700_000,
      -104_900_000,
    );
  });

  it('keeps a missing path as flood (-1) instead of forcing direct', async () => {
    const contact = makeContact(4, 0x10);
    const { conn, addOrUpdateContact } = makeConn([contact]);
    await setMeshcoreRadioContactFlag(
      conn,
      pubkeyToNodeId(contact.publicKey),
      MESHCORE_CONTACT_FLAG_REMOTE_CLI,
      false,
    );
    const call = addOrUpdateContact.mock.calls[0] as unknown[];
    expect(call[2]).toBe(0);
    expect(call[3]).toBe(-1);
  });

  it('returns null and writes nothing when the contact is not on the radio', async () => {
    const { conn, addOrUpdateContact } = makeConn([makeContact(1, 0)]);
    await expect(
      setMeshcoreRadioContactFlag(conn, 0xdeadbeef, MESHCORE_CONTACT_FLAG_REMOTE_CLI, true),
    ).resolves.toBeNull();
    expect(addOrUpdateContact).not.toHaveBeenCalled();
  });
});

describe('readMeshcoreRadioContactFlags', () => {
  it('returns the flags byte or null', async () => {
    const contact = makeContact(6, 0x12);
    const { conn } = makeConn([contact]);
    await expect(
      readMeshcoreRadioContactFlags(conn, pubkeyToNodeId(contact.publicKey)),
    ).resolves.toBe(0x12);
    await expect(readMeshcoreRadioContactFlags(conn, 1)).resolves.toBeNull();
  });
});
