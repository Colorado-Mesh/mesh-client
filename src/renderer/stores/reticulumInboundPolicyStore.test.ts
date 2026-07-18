import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReticulumInboundPolicyStore } from './reticulumInboundPolicyStore';

const ROW = {
  identity_hash: 'e'.repeat(32),
  decision: 'allow' as const,
  label: 'Trusted peer',
  created_at: 1,
  updated_at: 1,
};

describe('reticulumInboundPolicyStore', () => {
  beforeEach(() => {
    useReticulumInboundPolicyStore.getState().clear();
    vi.mocked(window.electronAPI.db.listReticulumInboundPolicy).mockReset();
    vi.mocked(window.electronAPI.db.listReticulumInboundPolicy).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.upsertReticulumInboundPolicy).mockReset();
    vi.mocked(window.electronAPI.db.upsertReticulumInboundPolicy).mockResolvedValue({
      changes: 1,
    });
    vi.mocked(window.electronAPI.db.deleteReticulumInboundPolicy).mockReset();
    vi.mocked(window.electronAPI.db.deleteReticulumInboundPolicy).mockResolvedValue({
      changes: 1,
    });
  });

  it('hydrates policies from the DB IPC call, keyed by lowercase identity hash', async () => {
    vi.mocked(window.electronAPI.db.listReticulumInboundPolicy).mockResolvedValue([ROW]);
    await useReticulumInboundPolicyStore.getState().hydrate();
    const state = useReticulumInboundPolicyStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.policies.get(ROW.identity_hash)).toEqual(ROW);
  });

  it('upserts a decision and merges it into local state optimistically', async () => {
    await useReticulumInboundPolicyStore.getState().upsert({
      identity_hash: ROW.identity_hash,
      decision: 'block',
      label: 'Blocked peer',
    });
    expect(window.electronAPI.db.upsertReticulumInboundPolicy).toHaveBeenCalled();
    expect(useReticulumInboundPolicyStore.getState().decisionFor(ROW.identity_hash)).toBe('block');
  });

  it('removes a decision from local state after a successful delete', async () => {
    useReticulumInboundPolicyStore.setState({
      policies: new Map([[ROW.identity_hash, ROW]]),
      hydrated: true,
    });
    await useReticulumInboundPolicyStore.getState().remove(ROW.identity_hash);
    expect(window.electronAPI.db.deleteReticulumInboundPolicy).toHaveBeenCalledWith(
      ROW.identity_hash,
    );
    expect(
      useReticulumInboundPolicyStore.getState().decisionFor(ROW.identity_hash),
    ).toBeUndefined();
  });
});
