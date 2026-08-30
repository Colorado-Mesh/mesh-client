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
      blockedEntries: [],
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

  it('retains created_at for the list view while isBlocked still works', async () => {
    getBlockedContacts.mockResolvedValue([
      { blocked_hash: 'aa'.repeat(16), created_at: 200 },
      { blocked_hash: 'bb'.repeat(16), created_at: 100 },
    ]);

    await useBlockStore.getState().load('reticulum', 'id-1');

    const state = useBlockStore.getState();
    expect(state.blockedEntries).toEqual([
      { hash: 'aa'.repeat(16), createdAt: 200 },
      { hash: 'bb'.repeat(16), createdAt: 100 },
    ]);
    expect(state.isBlocked('aa'.repeat(16))).toBe(true);
    expect(state.blockedHashes.size).toBe(2);
  });

  it('block prepends a list entry and unblock removes it', async () => {
    blockContact.mockResolvedValue({ changes: 1 });
    unblockContact.mockResolvedValue({ changes: 1 });
    const hash = 'cc'.repeat(16);

    await useBlockStore.getState().block('reticulum', 'id-1', hash);
    expect(useBlockStore.getState().blockedEntries.map((e) => e.hash)).toEqual([hash]);

    await useBlockStore.getState().unblock('reticulum', 'id-1', hash);
    expect(useBlockStore.getState().blockedEntries).toEqual([]);
    expect(useBlockStore.getState().isBlocked(hash)).toBe(false);
  });

  it('blocking the same hash twice does not duplicate the list entry', async () => {
    blockContact.mockResolvedValue({ changes: 1 });
    const hash = 'dd'.repeat(16);

    await useBlockStore.getState().block('reticulum', 'id-1', hash);
    await useBlockStore.getState().block('reticulum', 'id-1', hash);

    expect(useBlockStore.getState().blockedEntries).toHaveLength(1);
  });

  it('clears both the set and the list when load fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useBlockStore.setState({
      blockedHashes: new Set(['ee'.repeat(16)]),
      blockedEntries: [{ hash: 'ee'.repeat(16), createdAt: 1 }],
    });
    getBlockedContacts.mockRejectedValue(new Error('db down'));

    await useBlockStore.getState().load('reticulum', 'id-1');

    expect(useBlockStore.getState().blockedEntries).toEqual([]);
    expect(useBlockStore.getState().blockedHashes.size).toBe(0);
    expect(useBlockStore.getState().loaded).toBe(true);
  });
});
