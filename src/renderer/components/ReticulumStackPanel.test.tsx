import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/renderer/lib/reticulum/reticulumGamesSession', () => ({
  refreshGamesSessions: vi.fn(async () => {}),
}));

vi.mock('@/renderer/lib/sessions/reticulumSession', () => ({
  tryGetReticulumSession: () => ({
    restartStack: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS } from '@/shared/reticulum-types';

import { ReticulumStackPanel } from './ReticulumStackPanel';

describe('ReticulumStackPanel', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.reticulum.getStatus).mockReset();
    vi.mocked(window.electronAPI.reticulum.syncInterfaceIssueScope).mockReset();
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 1,
      interfaceIssueAlert: null,
    });
    vi.mocked(window.electronAPI.reticulum.syncInterfaceIssueScope).mockResolvedValue({
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

  afterEach(() => {
    vi.useRealTimers();
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
      bleBondRemoved: [],
      blePairingTimedOut: [],
      transportSaturatedCount: 0,
      slowTransportQueryCount: 0,
      suppressedCount: 0,
      lastAtMs: Date.now(),
    };
    const statusWithAlert = {
      running: true,
      port: 19437,
      pid: 1,
      interfaceIssueAlert: issueAlert,
    };
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue(statusWithAlert);
    vi.mocked(window.electronAPI.reticulum.syncInterfaceIssueScope).mockResolvedValue(
      statusWithAlert,
    );
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({
          interfaces: [
            {
              id: 'ham',
              name: 'RNS HAM RADIO',
              type: 'tcpclient',
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
    let statusCb:
      | ((status: {
          running: boolean;
          port: number;
          pid: number | null;
          interfaceIssueAlert?: typeof issueAlert | null;
        }) => void)
      | null = null;
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
      statusCb?.(statusWithAlert);
    });

    await waitFor(() => {
      expect(
        screen.getByText('connectionPanel.reticulumSidecarIssues.heading:2'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.tcpConnectFailed:RNS HAM RADIO'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText('connectionPanel.reticulumSidecarIssues.txQueueDropsHint'),
      ).toBeInTheDocument();
    });
  });

  it('shows BLE TX-drop hint when interfaces include a ble:// RNode', async () => {
    const issueAlert = {
      tcpConnectFailed: [],
      txQueueDrops: [{ name: 'RNode 41F4', dropCount: 512 }],
      linkDeliveryTimeouts: [],
      bleBondRemoved: [],
      blePairingTimedOut: [],
      transportSaturatedCount: 0,
      slowTransportQueryCount: 0,
      suppressedCount: 0,
      lastAtMs: Date.now(),
    };
    const statusWithAlert = {
      running: true,
      port: 19437,
      pid: 1,
      interfaceIssueAlert: issueAlert,
    };
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue(statusWithAlert);
    vi.mocked(window.electronAPI.reticulum.syncInterfaceIssueScope).mockResolvedValue(
      statusWithAlert,
    );
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({
          interfaces: [
            {
              id: 'rnode-41f4',
              name: 'RNode 41F4',
              type: 'rnode',
              enabled: true,
              status: 'down',
              serial_port: 'ble://eccf2847-e1fd-3f5f-0811-064db1639a3d',
            },
          ],
        });
      }
      if (path === '/api/v1/serial/ports') {
        return Promise.resolve({ ports: [] });
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
    let statusCb:
      | ((status: {
          running: boolean;
          port: number;
          pid: number | null;
          interfaceIssueAlert?: typeof issueAlert | null;
        }) => void)
      | null = null;
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
      statusCb?.(statusWithAlert);
    });

    await waitFor(() => {
      expect(
        screen.getByText('connectionPanel.reticulumSidecarIssues.txQueueDropsHintBle'),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText('connectionPanel.reticulumSidecarIssues.txQueueDropsHint'),
    ).not.toBeInTheDocument();
  });

  it('syncs enabled interface names into main issue scope after hydrate', async () => {
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({
          interfaces: [
            {
              id: 'ham',
              name: 'RNS HAM RADIO',
              type: 'tcpclient',
              enabled: false,
              status: 'down',
              host: '127.0.0.1',
              port: 4242,
            },
            {
              id: 'heltec-v3',
              name: 'Heltec V3',
              type: 'rnode',
              enabled: true,
              status: 'up',
              serial_port: '/dev/cu.usbserial-7',
            },
          ],
        });
      }
      if (path === '/api/v1/serial/ports') {
        return Promise.resolve({
          ports: [{ path: '/dev/cu.usbserial-7', label: 'usbserial-7' }],
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

    render(
      <ReticulumStackPanel
        connecting={false}
        onStartStack={async () => {}}
        onStopStack={async () => {}}
      />,
    );

    await waitFor(() => {
      expect(window.electronAPI.reticulum.syncInterfaceIssueScope).toHaveBeenCalledWith([
        'Heltec V3',
      ]);
    });
  });

  it('does not sync interface issue scope before interfaces hydrate', async () => {
    let resolveInterfaces: ((value: unknown) => void) | null = null;
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/interfaces') {
        return new Promise((resolve) => {
          resolveInterfaces = resolve;
        });
      }
      if (path === '/api/v1/serial/ports') {
        return Promise.resolve({ ports: [] });
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

    render(
      <ReticulumStackPanel
        connecting={false}
        onStartStack={async () => {}}
        onStopStack={async () => {}}
      />,
    );

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyGet).toHaveBeenCalledWith('/api/v1/interfaces');
    });
    expect(window.electronAPI.reticulum.syncInterfaceIssueScope).not.toHaveBeenCalled();

    await act(async () => {
      resolveInterfaces?.({
        interfaces: [
          {
            id: 'heltec-v3',
            name: 'Heltec V3',
            type: 'rnode',
            enabled: true,
            status: 'up',
            serial_port: '/dev/cu.usbserial-7',
          },
        ],
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.electronAPI.reticulum.syncInterfaceIssueScope).toHaveBeenCalledWith([
        'Heltec V3',
      ]);
    });
  });

  it('applies syncInterfaceIssueScope return status without a follow-up getStatus for scope', async () => {
    const clearedStatus = {
      running: true,
      port: 19437,
      pid: 1,
      interfaceIssueAlert: null,
    };
    vi.mocked(window.electronAPI.reticulum.syncInterfaceIssueScope).mockResolvedValue(
      clearedStatus,
    );
    const getStatus = vi.mocked(window.electronAPI.reticulum.getStatus);

    render(
      <ReticulumStackPanel
        connecting={false}
        onStartStack={async () => {}}
        onStopStack={async () => {}}
      />,
    );

    await waitFor(() => {
      expect(window.electronAPI.reticulum.syncInterfaceIssueScope).toHaveBeenCalled();
    });
    const getStatusAfterHydrate = getStatus.mock.calls.length;
    await act(async () => {
      await Promise.resolve();
    });
    // Success path applies returned status; no extra getStatus from the sync effect.
    expect(getStatus.mock.calls.length).toBe(getStatusAfterHydrate);
  });

  it('refreshes sidecar status when interface issue alert TTL elapses', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const lastAtMs = Date.now() - RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS + 5_000;
    const issueAlert = {
      tcpConnectFailed: ['RNS HAM RADIO'],
      txQueueDrops: [],
      linkDeliveryTimeouts: [],
      bleBondRemoved: [],
      blePairingTimedOut: [],
      transportSaturatedCount: 0,
      slowTransportQueryCount: 0,
      suppressedCount: 0,
      lastAtMs,
    };
    const statusWithAlert = {
      running: true,
      port: 19437,
      pid: 1,
      interfaceIssueAlert: issueAlert,
    };
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue(statusWithAlert);
    vi.mocked(window.electronAPI.reticulum.syncInterfaceIssueScope).mockResolvedValue(
      statusWithAlert,
    );
    let statusCb:
      | ((status: {
          running: boolean;
          port: number;
          pid: number | null;
          interfaceIssueAlert?: typeof issueAlert | null;
        }) => void)
      | null = null;
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
      statusCb?.(statusWithAlert);
    });

    const callsBeforeTtl = vi.mocked(window.electronAPI.reticulum.getStatus).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(vi.mocked(window.electronAPI.reticulum.getStatus).mock.calls.length).toBeGreaterThan(
      callsBeforeTtl,
    );
  });
});
