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
    useBlockStore.setState({ byProtocol: {} });
  });

  it('loads blocked hashes from IPC', async () => {
    getBlockedContacts.mockResolvedValue([
      { blocked_hash: 'ABCDEF1234567890ABCDEF1234567890', created_at: 1 },
    ]);
    await useBlockStore.getState().load('reticulum', 'id-1');
    expect(
      useBlockStore.getState().isBlocked('abcdef1234567890abcdef1234567890', 'reticulum'),
    ).toBe(true);
  });

  it('block adds hash locally after IPC', async () => {
    blockContact.mockResolvedValue({ changes: 1 });
    await useBlockStore.getState().block('reticulum', 'id-1', 'deadbeef');
    expect(blockContact).toHaveBeenCalledWith('reticulum', 'id-1', 'deadbeef');
    expect(useBlockStore.getState().isBlocked('deadbeef', 'reticulum')).toBe(true);
  });

  it('retains created_at for the list view while isBlocked still works', async () => {
    getBlockedContacts.mockResolvedValue([
      { blocked_hash: 'aa'.repeat(16), created_at: 200 },
      { blocked_hash: 'bb'.repeat(16), created_at: 100 },
    ]);

    await useBlockStore.getState().load('reticulum', 'id-1');

    const bucket = useBlockStore.getState().byProtocol.reticulum!;
    expect(bucket.entries).toEqual([
      { hash: 'aa'.repeat(16), createdAt: 200 },
      { hash: 'bb'.repeat(16), createdAt: 100 },
    ]);
    expect(useBlockStore.getState().isBlocked('aa'.repeat(16), 'reticulum')).toBe(true);
    expect(bucket.hashes.size).toBe(2);
  });

  it('block prepends a list entry and unblock removes it', async () => {
    blockContact.mockResolvedValue({ changes: 1 });
    unblockContact.mockResolvedValue({ changes: 1 });
    const hash = 'cc'.repeat(16);

    await useBlockStore.getState().block('reticulum', 'id-1', hash);
    expect(useBlockStore.getState().byProtocol.reticulum!.entries.map((e) => e.hash)).toEqual([
      hash,
    ]);

    await useBlockStore.getState().unblock('reticulum', 'id-1', hash);
    expect(useBlockStore.getState().byProtocol.reticulum!.entries).toEqual([]);
    expect(useBlockStore.getState().isBlocked(hash, 'reticulum')).toBe(false);
  });

  it('blocking the same hash twice does not duplicate the list entry', async () => {
    blockContact.mockResolvedValue({ changes: 1 });
    const hash = 'dd'.repeat(16);

    await useBlockStore.getState().block('reticulum', 'id-1', hash);
    await useBlockStore.getState().block('reticulum', 'id-1', hash);

    expect(useBlockStore.getState().byProtocol.reticulum!.entries).toHaveLength(1);
  });

  it('clears both the set and the list when load fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useBlockStore.setState({
      byProtocol: {
        reticulum: {
          identityId: 'id-1',
          hashes: new Set(['ee'.repeat(16)]),
          entries: [{ hash: 'ee'.repeat(16), createdAt: 1 }],
          loaded: true,
        },
      },
    });
    getBlockedContacts.mockRejectedValue(new Error('db down'));

    await useBlockStore.getState().load('reticulum', 'id-1');

    const bucket = useBlockStore.getState().byProtocol.reticulum!;
    expect(bucket.entries).toEqual([]);
    expect(bucket.hashes.size).toBe(0);
    expect(bucket.loaded).toBe(true);
  });

  it('keeps one blocklist per protocol without cross-protocol matches', async () => {
    getBlockedContacts.mockImplementation((protocol: string) =>
      Promise.resolve(
        protocol === 'meshtastic'
          ? [{ blocked_hash: '305419896', created_at: 1 }]
          : [{ blocked_hash: 'aa'.repeat(16), created_at: 1 }],
      ),
    );
    await useBlockStore.getState().load('reticulum', 'rid');
    await useBlockStore.getState().load('meshtastic', 'lora-blocklist');

    const s = useBlockStore.getState();
    expect(s.isBlocked('305419896', 'meshtastic')).toBe(true);
    expect(s.isBlocked('305419896', 'meshcore')).toBe(false);
    expect(s.isBlocked('aa'.repeat(16), 'reticulum')).toBe(true);
    expect(s.isBlocked('aa'.repeat(16), 'meshtastic')).toBe(false);
    expect(s.byProtocol.reticulum?.identityId).toBe('rid');
  });
});
