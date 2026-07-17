import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetRrcHubDisconnectSuppressForTests,
  setRrcHubDisconnectSuppressed,
} from '@/renderer/lib/rrcHubDisconnectSuppress';
import { saveRrcHubAutoJoin } from '@/renderer/lib/rrcHubPrefs';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

import { runRrcHubAutoConnectBatch } from './useRrcStartupAutoConnect';

describe('runRrcHubAutoConnectBatch', () => {
  beforeEach(() => {
    localStorage.clear();
    resetRrcHubDisconnectSuppressForTests();
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

  it('skips hubs with sticky disconnect suppress', async () => {
    const hub = 'aabbccddeeff00112233445566778899';
    saveRrcHubAutoJoin([hub]);
    setRrcHubDisconnectSuppressed(hub, true);
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
  });
});
