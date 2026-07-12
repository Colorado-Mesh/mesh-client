import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLongSessionMaintenance } from './useLongSessionMaintenance';

const addToast = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ addToast }),
}));

describe('useLongSessionMaintenance', () => {
  beforeEach(() => {
    addToast.mockClear();
    sessionStorage.clear();
    vi.stubGlobal('electronAPI', undefined);
    window.electronAPI = {
      getProcessUptimeSec: vi.fn().mockResolvedValue(4 * 24 * 60 * 60),
    } as unknown as typeof window.electronAPI;
  });

  it('shows one restart nudge toast after four-day uptime', async () => {
    renderHook(() => {
      useLongSessionMaintenance();
    });

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('toasts.longSessionRestartNudge', 'warning', 12_000);
    });
    expect(sessionStorage.getItem('mesh-client:longSessionRestartNudgeShown')).toBe('1');
  });

  it('suppresses duplicate nudges when sessionStorage flag is set', () => {
    sessionStorage.setItem('mesh-client:longSessionRestartNudgeShown', '1');
    renderHook(() => {
      useLongSessionMaintenance();
    });
    expect(addToast).not.toHaveBeenCalled();
  });
});
