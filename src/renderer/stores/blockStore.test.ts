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

  it('re-reads when a block lands while load is in flight so the block is not lost', async () => {
    const hash = 'ff'.repeat(16);
    let releaseFirst!: (rows: unknown[]) => void;
    getBlockedContacts
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce([{ blocked_hash: hash, created_at: 5 }]);
    blockContact.mockResolvedValue({ changes: 1 });

    const loading = useBlockStore.getState().load('meshtastic', 'lora-blocklist');
    await useBlockStore.getState().block('meshtastic', 'lora-blocklist', hash);
    releaseFirst([]);
    await loading;

    expect(getBlockedContacts).toHaveBeenCalledTimes(2);
    expect(useBlockStore.getState().isBlocked(hash, 'meshtastic')).toBe(true);
    expect(useBlockStore.getState().byProtocol.meshtastic!.entries.map((e) => e.hash)).toEqual([
      hash,
    ]);
  });
});
