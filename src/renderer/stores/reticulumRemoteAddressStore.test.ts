import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReticulumRemoteAddressStore } from './reticulumRemoteAddressStore';

const ROW = {
  id: 'addr1',
  label: 'Test Node',
  service: 'rnsh' as const,
  destination_hash: 'c'.repeat(32),
  lxmf_peer_hash: 'd'.repeat(32),
  created_at: 1,
  updated_at: 1,
};

describe('reticulumRemoteAddressStore', () => {
  beforeEach(() => {
    useReticulumRemoteAddressStore.getState().clear();
    vi.mocked(window.electronAPI.db.listReticulumRemoteAddresses).mockReset();
    vi.mocked(window.electronAPI.db.listReticulumRemoteAddresses).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.upsertReticulumRemoteAddress).mockReset();
    vi.mocked(window.electronAPI.db.upsertReticulumRemoteAddress).mockResolvedValue({
      changes: 1,
    });
    vi.mocked(window.electronAPI.db.deleteReticulumRemoteAddress).mockReset();
    vi.mocked(window.electronAPI.db.deleteReticulumRemoteAddress).mockResolvedValue({
      changes: 1,
    });
  });

  it('hydrates addresses from the DB IPC call', async () => {
    vi.mocked(window.electronAPI.db.listReticulumRemoteAddresses).mockResolvedValue([ROW]);
    await useReticulumRemoteAddressStore.getState().hydrate();
    const state = useReticulumRemoteAddressStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.addresses.get('addr1')).toEqual(ROW);
  });

  it('upserts an address and re-hydrates to pick up the server-generated row', async () => {
    vi.mocked(window.electronAPI.db.listReticulumRemoteAddresses).mockResolvedValue([ROW]);
    const result = await useReticulumRemoteAddressStore.getState().upsert({
      label: ROW.label,
      service: ROW.service,
      destination_hash: ROW.destination_hash,
    });
    expect(window.electronAPI.db.upsertReticulumRemoteAddress).toHaveBeenCalled();
    expect(result?.id).toBe('addr1');
  });

  it('resolves both concurrent upserts once the DB reflects both rows', async () => {
    const rowA = { ...ROW, id: 'addrA', destination_hash: 'a'.repeat(32) };
    const rowB = { ...ROW, id: 'addrB', destination_hash: 'b'.repeat(32) };
    // The DB (via the list IPC) only knows about a row after its write lands; the second
    // hydrate must re-fetch instead of piggybacking on the first in-flight load.
    vi.mocked(window.electronAPI.db.listReticulumRemoteAddresses)
      .mockResolvedValueOnce([rowA])
      .mockResolvedValue([rowA, rowB]);

    const [resultA, resultB] = await Promise.all([
      useReticulumRemoteAddressStore.getState().upsert({
        label: rowA.label,
        service: rowA.service,
        destination_hash: rowA.destination_hash,
      }),
      useReticulumRemoteAddressStore.getState().upsert({
        label: rowB.label,
        service: rowB.service,
        destination_hash: rowB.destination_hash,
      }),
    ]);

    expect(resultA?.id).toBe('addrA');
    expect(resultB?.id).toBe('addrB');
  });

  it('removes an address from local state after a successful delete', async () => {
    useReticulumRemoteAddressStore.setState({
      addresses: new Map([[ROW.id, ROW]]),
      hydrated: true,
    });
    await useReticulumRemoteAddressStore.getState().remove(ROW.id);
    expect(window.electronAPI.db.deleteReticulumRemoteAddress).toHaveBeenCalledWith(ROW.id);
    expect(useReticulumRemoteAddressStore.getState().addresses.has(ROW.id)).toBe(false);
  });

  it('finds a saved address by destination hash and service', () => {
    useReticulumRemoteAddressStore.setState({
      addresses: new Map([[ROW.id, ROW]]),
      hydrated: true,
    });
    const found = useReticulumRemoteAddressStore
      .getState()
      .findByDestination(ROW.destination_hash.toUpperCase(), 'rnsh');
    expect(found?.id).toBe(ROW.id);
    expect(
      useReticulumRemoteAddressStore.getState().findByDestination(ROW.destination_hash, 'rncp'),
    ).toBeUndefined();
  });

  it('finds a saved address by lxmf peer hash', () => {
    useReticulumRemoteAddressStore.setState({
      addresses: new Map([[ROW.id, ROW]]),
      hydrated: true,
    });
    const found = useReticulumRemoteAddressStore.getState().findByLxmfPeer(ROW.lxmf_peer_hash);
    expect(found?.id).toBe(ROW.id);
  });
});
