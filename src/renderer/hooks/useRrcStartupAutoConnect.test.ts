import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveRrcHubAutoJoin } from '@/renderer/lib/rrcHubPrefs';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

import { runRrcHubAutoConnectBatch } from './useRrcStartupAutoConnect';

describe('runRrcHubAutoConnectBatch', () => {
  beforeEach(() => {
    localStorage.clear();
    useRrcSessionStore.setState({
      sessionsByHub: new Map(),
      focusedHubHash: null,
    });
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();
  });

  it('no-ops when no hubs are marked for auto-join', async () => {
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
  });

  it('connects pending auto-join hubs', async () => {
    saveRrcHubAutoJoin(['aabbccddeeff00112233445566778899']);
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledWith({
      dest_hash: 'aabbccddeeff00112233445566778899',
      nickname: 'tester',
    });
  });
});
