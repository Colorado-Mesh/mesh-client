import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReticulumSharedInstanceClientBanner } from './ReticulumSharedInstanceClientBanner';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('ReticulumSharedInstanceClientBanner', () => {
  beforeEach(() => {
    vi.stubGlobal('electronAPI', {
      reticulum: {
        proxyGet: vi.fn().mockResolvedValue({
          enable_transport: false,
          share_instance: true,
          loglevel: 4,
          announce_interval_sec: 3600,
        }),
        proxyPut: vi.fn().mockResolvedValue({ ok: true }),
      },
    });
  });

  it('disables share instance then restarts via callback', async () => {
    const user = userEvent.setup();
    const onRestartStack = vi.fn();
    render(<ReticulumSharedInstanceClientBanner onRestartStack={onRestartStack} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumSharedInstance.disableShareAria',
      }),
    );

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith(
        '/api/v1/stack/settings',
        expect.objectContaining({ share_instance: false }),
      );
      expect(onRestartStack).toHaveBeenCalled();
    });
  });
});
