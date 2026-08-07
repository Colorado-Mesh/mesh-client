import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetRrcHubDisconnectSuppressForTests,
  setRrcHubDisconnectSuppressed,
} from '@/renderer/lib/rrcHubDisconnectSuppress';
import { saveRrcHubAutoJoin } from '@/renderer/lib/rrcHubPrefs';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

import { runRrcHubAutoConnectBatch } from './useRrcStartupAutoConnect';

const HOOK_SOURCE = readFileSync(join(__dirname, 'useRrcStartupAutoConnect.ts'), 'utf-8');

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

  it('skips already-linked hubs via pendingRrcAutoJoinHubs', async () => {
    const linked = 'aabbccddeeff00112233445566778899';
    const pending = '112233445566778899aabbccddeeff00';
    saveRrcHubAutoJoin([linked, pending]);
    useRrcSessionStore.getState().applyStatus('active', linked, 'Linked Hub');

    await runRrcHubAutoConnectBatch('tester');

    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledWith({
      dest_hash: pending,
      nickname: 'tester',
    });
  });
});

describe('useRrcStartupAutoConnect poll timing (source contract)', () => {
  it('uses 500ms fast / 4000ms steady poll and RETICULUM_CONFIGURED_EVENT', () => {
    expect(HOOK_SOURCE).toMatch(/RRC_AUTO_CONNECT_FAST_MS\s*=\s*500/);
    expect(HOOK_SOURCE).toMatch(/RRC_AUTO_CONNECT_STEADY_MS\s*=\s*4_000/);
    expect(HOOK_SOURCE).toContain('RETICULUM_CONFIGURED_EVENT');
    expect(HOOK_SOURCE).toMatch(
      /schedule\(pending\.length > 0 \? RRC_AUTO_CONNECT_FAST_MS : RRC_AUTO_CONNECT_STEADY_MS\)/,
    );
    expect(HOOK_SOURCE).toMatch(
      /window\.addEventListener\(RETICULUM_CONFIGURED_EVENT, onConfigured\)/,
    );
    expect(HOOK_SOURCE).toMatch(
      /window\.removeEventListener\(RETICULUM_CONFIGURED_EVENT, onConfigured\)/,
    );
  });
});
