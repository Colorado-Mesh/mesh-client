import { beforeEach, describe, expect, it, vi } from 'vitest';

const getBlockedContacts = vi.fn();
const blockContact = vi.fn();
const unblockContact = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    db: {
      getBlockedContacts,
      blockContact,
      unblockContact,
    },
  },
});

import { useBlockStore } from './blockStore';

describe('blockStore', () => {
  beforeEach(() => {
    getBlockedContacts.mockReset();
    blockContact.mockReset();
    unblockContact.mockReset();
    useBlockStore.setState({
      protocol: null,
      identityId: null,
      blockedHashes: new Set(),
      loaded: false,
    });
  });

  it('loads blocked hashes from IPC', async () => {
    getBlockedContacts.mockResolvedValue([
      { blocked_hash: 'ABCDEF1234567890ABCDEF1234567890', created_at: 1 },
    ]);
    await useBlockStore.getState().load('reticulum', 'id-1');
    expect(useBlockStore.getState().isBlocked('abcdef1234567890abcdef1234567890')).toBe(true);
  });

  it('block adds hash locally after IPC', async () => {
    blockContact.mockResolvedValue({ changes: 1 });
    await useBlockStore.getState().block('reticulum', 'id-1', 'deadbeef');
    expect(blockContact).toHaveBeenCalledWith('reticulum', 'id-1', 'deadbeef');
    expect(useBlockStore.getState().isBlocked('deadbeef')).toBe(true);
  });
});
