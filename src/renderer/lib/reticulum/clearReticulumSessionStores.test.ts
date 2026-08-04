// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
