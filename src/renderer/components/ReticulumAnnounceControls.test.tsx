import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from './Toast';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      if (opts?.error) return `${key}:${opts.error}`;
      return key;
    },
  }),
}));

const isReticulumSidecarRunning = vi.fn();
vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: () => isReticulumSidecarRunning(),
}));

import { ReticulumAnnounceControls } from './ReticulumAnnounceControls';

describe('ReticulumAnnounceControls', () => {
  beforeEach(() => {
    isReticulumSidecarRunning.mockResolvedValue(true);
    window.electronAPI.reticulum.proxyGet = vi.fn().mockResolvedValue({
      enable_transport: false,
      share_instance: true,
      loglevel: 4,
      announce_interval_sec: 0,
    });
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({ ok: true });
  });

  it('saves announce interval and shows status when sidecar is running', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ReticulumAnnounceControls disabled={false} />
      </ToastProvider>,
    );

    const input = await screen.findByLabelText('reticulumIdentity.announceIntervalSec');
    await user.clear(input);
    await user.type(input, '300');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith('/api/v1/stack/settings', {
        enable_transport: false,
        share_instance: true,
        loglevel: 4,
        announce_interval_sec: 300,
      });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('reticulumIdentity.announceSaved');
  });

  it('remains clickable when parent only gates on sidecar readiness (not connecting)', () => {
    render(
      <ToastProvider>
        <ReticulumAnnounceControls disabled={false} />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: 'common.save' })).not.toBeDisabled();
  });
});
