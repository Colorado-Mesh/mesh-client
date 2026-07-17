import { describe, expect, it, vi } from 'vitest';

import {
  isMeshcoreFloodScopeOverrideActive,
  withMeshcoreFloodScopeOverride,
} from './meshcoreFloodScopeSend';

vi.mock('./meshcoreRepeaterRpcInFlight', () => ({
  meshcoreCompanionRepeaterRfBusy: vi.fn(() => false),
}));

import { meshcoreCompanionRepeaterRfBusy } from './meshcoreRepeaterRpcInFlight';

describe('withMeshcoreFloodScopeOverride', () => {
  it('skips apply when no override', async () => {
    const apply = vi.fn();
    const send = vi.fn().mockResolvedValue(undefined);
    await withMeshcoreFloodScopeOverride(apply, '#colorado', undefined, send);
    expect(apply).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
  });

  it('restores scope when send rejects', async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockRejectedValue(new Error('rf busy'));
    await expect(
      withMeshcoreFloodScopeOverride(apply, '#colorado', '#denver', send),
    ).rejects.toThrow('rf busy');
    expect(apply).toHaveBeenNthCalledWith(1, '#denver');
    expect(apply).toHaveBeenNthCalledWith(2, '#colorado');
  });

  it('restores scope after successful send', async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    await withMeshcoreFloodScopeOverride(apply, '', '#denver', send);
    expect(apply.mock.calls).toEqual([['#denver'], ['']]);
  });

  it('refuses override while companion RF is busy', async () => {
    vi.mocked(meshcoreCompanionRepeaterRfBusy).mockReturnValueOnce(true);
    const apply = vi.fn();
    const send = vi.fn();
    await expect(
      withMeshcoreFloodScopeOverride(apply, '#colorado', '#denver', send),
    ).rejects.toThrow('meshcore.errors.floodScopeBusy');
    expect(apply).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('marks override active during send', async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    let sawActive = false;
    const send = vi.fn().mockImplementation(() => {
      sawActive = isMeshcoreFloodScopeOverrideActive();
      return Promise.resolve();
    });
    await withMeshcoreFloodScopeOverride(apply, '', '#denver', send);
    expect(sawActive).toBe(true);
    expect(isMeshcoreFloodScopeOverrideActive()).toBe(false);
  });
});
