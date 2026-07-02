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
    window.electronAPI.reticulum.proxyDelete = vi.fn().mockResolvedValue({ ok: true });
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

  it('clamps announce interval to 86400 on save', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ReticulumAnnounceControls disabled={false} />
      </ToastProvider>,
    );

    const input = await screen.findByLabelText('reticulumIdentity.announceIntervalSec');
    await user.clear(input);
    await user.type(input, '999999');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith(
        '/api/v1/stack/settings',
        expect.objectContaining({ announce_interval_sec: 86400 }),
      );
    });
  });

  it('shows error when sidecar is stopped on save', async () => {
    isReticulumSidecarRunning.mockResolvedValue(false);
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ReticulumAnnounceControls disabled={false} />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'common.save' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'reticulumIdentity.announceSaveSidecarStopped',
    );
    expect(window.electronAPI.reticulum.proxyPut).not.toHaveBeenCalled();
  });

  it('clears announces when sidecar is running', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ReticulumAnnounceControls disabled={false} />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'reticulumIdentity.clearAnnounces' }));
    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyDelete).toHaveBeenCalledWith('/api/v1/announces');
    });
  });

  it('surfaces proxyPut failure', async () => {
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({ ok: false, error: 'nope' });
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ReticulumAnnounceControls disabled={false} />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'common.save' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'reticulumIdentity.announceSaveFailed:nope',
    );
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
