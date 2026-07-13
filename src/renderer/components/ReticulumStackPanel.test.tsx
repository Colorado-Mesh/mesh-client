import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'count' in opts) return `${key}:${opts.count}`;
      if (opts && 'name' in opts && 'port' in opts && 'host' in opts) {
        const host =
          typeof opts.host === 'string' || typeof opts.host === 'number' ? String(opts.host) : '';
        const port =
          typeof opts.port === 'string' || typeof opts.port === 'number' ? String(opts.port) : '';
        return host ? `${key}:${opts.name}:${host}:${port}` : `${key}:${opts.name}:${port}`;
      }
      if (opts && 'name' in opts && 'port' in opts) {
        return `${key}:${opts.name}:${opts.port}`;
      }
      if (opts && 'name' in opts) {
        return `${key}:${opts.name}`;
      }
      return key;
    },
  }),
}));

vi.mock('@/renderer/lib/sessions/reticulumSession', () => ({
  tryGetReticulumSession: () => ({
    restartStack: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { ReticulumStackPanel } from './ReticulumStackPanel';

describe('ReticulumStackPanel', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 1,
      interfaceIssueAlert: null,
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
      if (path === '/api/v1/stack/settings') {
        return Promise.resolve({
          enable_transport: true,
          share_instance: false,
          loglevel: 4,
          announce_interval_sec: 3600,
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

  it('hides USB serial port list for offline BLE RNode alerts', async () => {
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({
          interfaces: [
            {
              id: 'rnode-ble',
              name: 'rnode-4b91c793',
              type: 'rnode',
              enabled: true,
              status: 'down',
              serial_port: 'ble://a399d3be-fa79-45ab',
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

    render(
      <ReticulumStackPanel
        connecting={false}
        onStartStack={async () => {}}
        onStopStack={async () => {}}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText('connectionPanel.reticulumLocalInterfaces.connectingHeading:1'),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText('connectionPanel.reticulumLocalInterfaces.needsAttention:1'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Available:/)).not.toBeInTheDocument();
    expect(
      screen.queryByText('connectionPanel.reticulumLocalInterfaces.restartStack'),
    ).not.toBeInTheDocument();
  });

  it('clears offline BLE alert after interface comes up on periodic refresh', async () => {
    vi.useFakeTimers();
    let bleStatus = 'down';
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({
          interfaces: [
            {
              id: 'nv0n2',
              name: 'NV0N2',
              type: 'rnode',
              enabled: true,
              status: bleStatus,
              serial_port: 'ble://a399d3be-fa79-45ab-a394-7d9299682617',
            },
          ],
        });
      }
      if (path === '/api/v1/serial/ports') {
        return Promise.resolve({ ports: [] });
      }
      return Promise.resolve({});
    });

    render(
      <ReticulumStackPanel
        connecting={false}
        onStartStack={async () => {}}
        onStopStack={async () => {}}
      />,
    );

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(
      screen.getByText('connectionPanel.reticulumLocalInterfaces.connectingHeading:1'),
    ).toBeInTheDocument();

    bleStatus = 'up';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(
      screen.queryByText('connectionPanel.reticulumLocalInterfaces.connectingHeading:1'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('connectionPanel.reticulumLocalInterfaces.needsAttention:1'),
    ).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it('shows TCP hub unreachable alert when enabled tcp interface is down', async () => {
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({
          interfaces: [
            {
              id: 'ham',
              name: 'RNS HAM RADIO',
              type: 'tcp',
              enabled: true,
              status: 'down',
              host: '135.125.238.229',
              port: 4242,
            },
          ],
        });
      }
      if (path === '/api/v1/serial/ports') {
        return Promise.resolve({ ports: [] });
      }
      return Promise.resolve({});
    });

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
        'connectionPanel.reticulumLocalInterfaces.tcpUnreachable:RNS HAM RADIO:135.125.238.229:4242',
      ),
    ).toBeInTheDocument();
  });

  it('shows sidecar issue alert when interfaceIssueAlert is present', async () => {
    const issueAlert = {
      tcpConnectFailed: ['RNS HAM RADIO'],
      txQueueDrops: [{ name: 'RNS HAM RADIO', dropCount: 128 }],
      linkDeliveryTimeouts: [],
      transportSaturatedCount: 0,
      slowTransportQueryCount: 0,
      suppressedCount: 0,
      lastAtMs: Date.now(),
    };
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 1,
      interfaceIssueAlert: issueAlert,
    });
    let statusCb:
      ((status: { running: boolean; port: number; pid: number | null }) => void) | null = null;
    window.electronAPI.reticulum.onStatus = vi.fn((cb) => {
      statusCb = cb;
      return () => {};
    });

    render(
      <ReticulumStackPanel
        connecting={false}
        onStartStack={async () => {}}
        onStopStack={async () => {}}
      />,
    );

    act(() => {
      statusCb?.({
        running: true,
        port: 19437,
        pid: 1,
        interfaceIssueAlert: issueAlert,
      } as never);
    });

    await waitFor(() => {
      expect(
        screen.getByText('connectionPanel.reticulumSidecarIssues.heading:2'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.tcpConnectFailed:RNS HAM RADIO'),
    ).toBeInTheDocument();
  });
});
