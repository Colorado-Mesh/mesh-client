// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRelayCoverageStore } from '@/renderer/lib/relayCoverage/relayCoverageStore';
import { useReticulumGamesStore } from '@/renderer/stores/reticulumGamesStore';
import { useReticulumVoiceStore } from '@/renderer/stores/reticulumVoiceStore';

import { clearReticulumSessionStores } from './clearReticulumSessionStores';

const hangup = vi.fn();
const stopMedia = vi.fn();

vi.mock('@/renderer/lib/reticulumVoiceSession', () => ({
  stopReticulumVoiceMedia: (...args: unknown[]) => stopMedia(...args),
}));

vi.mock('@/renderer/lib/reticulum/reticulumBleAdapterConflict', () => ({
  releaseReticulumBleRnodeConnect: vi.fn(() => Promise.resolve()),
}));

describe('clearReticulumSessionStores', () => {
  beforeEach(() => {
    hangup.mockReset();
    hangup.mockResolvedValue({ ok: true });
    stopMedia.mockReset();
    useReticulumVoiceStore.getState().clearCall();
    Object.assign(window, {
      electronAPI: {
        reticulum: { voice: { hangup } },
      },
    });
  });

  it('stops voice media and clears active call', () => {
    useReticulumVoiceStore.getState().beginOutgoing('a'.repeat(32));
    clearReticulumSessionStores();
    expect(stopMedia).toHaveBeenCalled();
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
    expect(hangup).toHaveBeenCalled();
  });

  it('skips hangup when no voice session is busy', () => {
    clearReticulumSessionStores();
    expect(hangup).not.toHaveBeenCalled();
    expect(stopMedia).toHaveBeenCalled();
  });

  it('clears the games store', () => {
    useReticulumGamesStore.getState().upsertSession({
      session_id: 's1',
      identity_id: 'me',
      app_id: 'ttt',
      app_version: 1,
      contact_hash: 'a'.repeat(32),
      initiator: 'me',
      status: 'pending',
      metadata: {},
      unread: 1,
      created_at: 1,
      updated_at: 1,
      last_action_at: 1,
    });
    useReticulumGamesStore.getState().selectSession('s1');
    expect(useReticulumGamesStore.getState().sessions).toHaveLength(1);
    clearReticulumSessionStores();
    expect(useReticulumGamesStore.getState().selectedSessionId).toBeNull();
    expect(useReticulumGamesStore.getState().sessions).toHaveLength(0);
  });

  it('clears reticulum relay coverage entries', () => {
    useRelayCoverageStore.getState().set('rns-id', 'm1', {
      protocol: 'reticulum',
      mode: 'predicted',
      predictedRelayHops: 2,
    });
    useRelayCoverageStore.getState().set('mc-id', 'm2', {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [],
    });
    clearReticulumSessionStores();
    expect(useRelayCoverageStore.getState().coverageFor('rns-id', 'm1')).toBeUndefined();
    expect(useRelayCoverageStore.getState().coverageFor('mc-id', 'm2')).toBeDefined();
  });
});
