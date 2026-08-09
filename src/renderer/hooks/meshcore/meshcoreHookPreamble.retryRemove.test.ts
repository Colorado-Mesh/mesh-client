import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeshCoreContactRaw } from '../../lib/meshcore/meshcoreHookTypes';
import {
  markMeshcoreLocallyDeletedContact,
  resetMeshcoreLocallyDeletedContactsForTests,
} from '../../lib/meshcoreLocallyDeletedContacts';
import { pubkeyToNodeId } from '../../lib/meshcoreUtils';
import { retryRadioRemoveDeletedContacts } from './meshcoreHookPreamble';

function contact(seed: number): MeshCoreContactRaw {
  const publicKey = new Uint8Array(32);
  for (let i = 0; i < publicKey.length; i++) publicKey[i] = (seed + i * 7) & 0xff;
  return {
    publicKey,
    type: 1,
    advName: `Node-${seed}`,
    lastAdvert: 0,
    advLat: 0,
    advLon: 0,
    flags: 0,
  };
}

describe('retryRadioRemoveDeletedContacts', () => {
  beforeEach(() => {
    resetMeshcoreLocallyDeletedContactsForTests();
  });

  it('drops a tombstoned contact when radio removal succeeds', async () => {
    const kept = contact(0x11);
    const deleted = contact(0x22);
    markMeshcoreLocallyDeletedContact(pubkeyToNodeId(deleted.publicKey));
    const removeContact = vi.fn().mockResolvedValue(undefined);

    const result = await retryRadioRemoveDeletedContacts({ removeContact }, [kept, deleted]);

    expect(removeContact).toHaveBeenCalledTimes(1);
    expect(removeContact).toHaveBeenCalledWith(deleted.publicKey);
    expect(result).toEqual([kept]);
  });

  it('keeps a tombstoned contact when radio removal fails (radio stays authority)', async () => {
    const deleted = contact(0x33);
    markMeshcoreLocallyDeletedContact(pubkeyToNodeId(deleted.publicKey));
    const removeContact = vi.fn().mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await retryRadioRemoveDeletedContacts({ removeContact }, [deleted]);

    expect(removeContact).toHaveBeenCalledTimes(1);
    expect(result).toEqual([deleted]);
  });

  it('never calls removeContact for contacts that are not tombstoned', async () => {
    const removeContact = vi.fn().mockResolvedValue(undefined);
    const contacts = [contact(0x44), contact(0x55)];

    const result = await retryRadioRemoveDeletedContacts({ removeContact }, contacts);

    expect(removeContact).not.toHaveBeenCalled();
    expect(result).toEqual(contacts);
  });
});
