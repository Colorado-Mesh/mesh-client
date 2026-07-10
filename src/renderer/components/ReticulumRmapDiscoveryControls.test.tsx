// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { GPS_SETTINGS_STORAGE_KEY } from '@/renderer/lib/gpsSource';

import { ReticulumRmapDiscoveryControls } from './ReticulumRmapDiscoveryControls';
import { ToastProvider } from './Toast';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      if (opts?.error) return `${key}:${opts.error}`;
      if (opts?.lat) return `${key}:${opts.lat}:${opts.lon}`;
      return key;
    },
  }),
}));

function renderControls(props?: Partial<ComponentProps<typeof ReticulumRmapDiscoveryControls>>) {
  return render(
    <ToastProvider>
      <ReticulumRmapDiscoveryControls
        disabled={false}
        sidecarApiReady
        identityDisplayName="Test Node"
        {...props}
      />
    </ToastProvider>,
  );
}

describe('ReticulumRmapDiscoveryControls', () => {
  beforeEach(() => {
    localStorage.clear();
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({
          interfaces: [
            {
              id: 'rnode-1',
              name: 'LoRa',
              type: 'rnode',
              enabled: true,
              status: 'up',
              serial_port: '/dev/ttyUSB0',
              discoverable: false,
            },
          ],
        });
      }
      if (path === '/api/v1/stack/settings') {
        return Promise.resolve({
          enable_transport: true,
          share_instance: true,
          loglevel: 4,
        });
      }
      return Promise.resolve({});
    });
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({});
    window.electronAPI.reticulum.proxyPost = vi.fn().mockResolvedValue({ id: 'hub-1' });
    window.electronAPI.appSettings.set = vi.fn().mockResolvedValue({ changes: 1 });
  });

  it('renders publish toggle and field labels', async () => {
    renderControls();
    expect(
      await screen.findByLabelText('reticulumRmapDiscovery.publishToggle'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('reticulumRmapDiscovery.announceIntervalMin')).toBeInTheDocument();
    expect(screen.getByLabelText('reticulumRmapDiscovery.heightMeters')).toBeInTheDocument();
    expect(screen.getByLabelText('reticulumRmapDiscovery.reachableOn')).toBeInTheDocument();
    expect(screen.getByText('reticulumRmapDiscovery.helpLink')).toBeInTheDocument();
  });

  it('shows GPS warning and blocks apply when coordinates missing', async () => {
    const user = userEvent.setup();
    renderControls();
    expect(await screen.findByText('reticulumRmapDiscovery.gpsMissingWarning')).toBeInTheDocument();
    await user.click(screen.getByLabelText('reticulumRmapDiscovery.publishToggle'));
    expect(await screen.findByText('reticulumRmapDiscovery.gpsRequiredTitle')).toBeInTheDocument();
    expect(window.electronAPI.reticulum.proxyPut).not.toHaveBeenCalled();
  });

  it('applies discovery settings when GPS is set', async () => {
    localStorage.setItem(
      GPS_SETTINGS_STORAGE_KEY,
      JSON.stringify({ staticLat: 40.01, staticLon: -105.02 }),
    );
    const user = userEvent.setup();
    renderControls();
    await screen.findByText(/reticulumRmapDiscovery.coordsStatus/);
    await user.click(screen.getByLabelText('reticulumRmapDiscovery.publishToggle'));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith(
        '/api/v1/interfaces/rnode-1',
        expect.objectContaining({ discoverable: true, latitude: 40.01 }),
      );
    });
    expect(await screen.findByText('reticulumRmapDiscovery.restartTitle')).toBeInTheDocument();
  });

  it('has no serious axe violations on GPS warning state', async () => {
    const { container } = renderControls();
    await screen.findByText('reticulumRmapDiscovery.gpsMissingWarning');
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
