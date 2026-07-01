import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'count' in opts) return `${key}:${opts.count}`;
      if (opts && 'name' in opts && 'port' in opts) {
        return `${key}:${opts.name}:${opts.port}`;
      }
      return key;
    },
  }),
}));

import { ReticulumStackPanel } from './ReticulumStackPanel';

describe('ReticulumStackPanel', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 1,
    });
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({
          interfaces: [
            {
              id: 'heltec-v3',
              name: 'Heltec V3',
              type: 'rnode',
              enabled: true,
              status: 'down',
              serial_port: '/dev/cu.usbserial-7',
            },
          ],
        });
      }
      if (path === '/api/v1/serial/ports') {
        return Promise.resolve({
          ports: [{ path: '/dev/cu.usbserial-0001', label: 'usbserial-0001' }],
        });
      }
      return Promise.resolve({});
    });
    window.electronAPI.reticulum.onStatus = vi.fn().mockReturnValue(() => {});
    window.electronAPI.reticulum.onEvent = vi.fn().mockReturnValue(() => {});
  });

  it('shows local interface alert when serial port is stale', async () => {
    render(
      <ReticulumStackPanel
        connecting={false}
        onStartStack={async () => {}}
        onStopStack={async () => {}}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText('connectionPanel.reticulumLocalInterfaces.needsAttention:1'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        'connectionPanel.reticulumLocalInterfaces.stalePort:Heltec V3:/dev/cu.usbserial-7',
      ),
    ).toBeInTheDocument();
  });

  it('calls onOpenRadioPanel when Open Radio is clicked', async () => {
    const user = userEvent.setup();
    const onOpenRadioPanel = vi.fn();
    render(
      <ReticulumStackPanel
        connecting={false}
        onStartStack={async () => {}}
        onStopStack={async () => {}}
        onOpenRadioPanel={onOpenRadioPanel}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText('connectionPanel.reticulumLocalInterfaces.openRadio'),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByText('connectionPanel.reticulumLocalInterfaces.openRadio'));
    expect(onOpenRadioPanel).toHaveBeenCalledTimes(1);
  });
});
