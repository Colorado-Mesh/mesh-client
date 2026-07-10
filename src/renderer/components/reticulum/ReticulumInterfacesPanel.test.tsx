import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildDefaultHubAddRequest,
  RETICULUM_DEFAULT_HUB_PRESETS,
} from '@/renderer/lib/reticulum/reticulumDefaultHubPresets';
import type {
  ReticulumInterfaceRow,
  ReticulumSerialPortOption,
} from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';
import { useConnectionStore } from '@/renderer/stores/connectionStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/components/Toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('@/renderer/lib/sessions/reticulumSession', () => ({
  tryGetReticulumSession: () => ({
    restartStack: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { ReticulumInterfacesPanel } from './ReticulumInterfacesPanel';

const defaultProps = {
  sidecarApiReady: true,
  connecting: false,
  interfaces: [] as ReticulumInterfaceRow[],
  serialPorts: [] as ReticulumSerialPortOption[],
  serialPortPaths: [] as string[],
  effectivePrimaryLocalSerialInterfaceId: null as string | null,
  onRefresh: vi.fn().mockResolvedValue(undefined),
  onBeginBleConnectGrace: vi.fn(),
};

describe('ReticulumInterfacesPanel', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    window.electronAPI.reticulum.proxyPost = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyDelete = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/serial/ports') {
        return Promise.resolve({ ports: [] });
      }
      if (path === '/api/v1/ble/availability') {
        return Promise.resolve({ available: false });
      }
      if (path === '/api/v1/rnode/presets') {
        return Promise.resolve({ presets: [] });
      }
      if (path === '/api/v1/config/audit') {
        return Promise.resolve({ issues: [] });
      }
      return Promise.resolve({});
    });
  });

  it('shows offline reason on local serial interface rows', () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'heltec',
            name: 'Heltec V3',
            type: 'rnode',
            enabled: true,
            status: 'down',
            serial_port: '/dev/cu.usbserial-7',
          },
        ]}
        serialPorts={[{ path: '/dev/cu.usbserial-0001' }]}
        serialPortPaths={['/dev/cu.usbserial-0001']}
      />,
    );

    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.localOfflineRowStale'),
    ).toBeInTheDocument();
  });

  it('does not flag BLE RNode interface rows as stale USB serial ports', () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'rnode-ble',
            name: 'RNode BLE',
            type: 'rnode',
            enabled: true,
            status: 'down',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
        ]}
        serialPorts={[{ path: '/dev/cu.usbserial-1' }]}
        serialPortPaths={['/dev/cu.usbserial-1']}
      />,
    );

    expect(screen.getByText('connectionPanel.reticulumInterfaces.rowSummary')).toBeInTheDocument();
    expect(
      screen.queryByText('connectionPanel.reticulumInterfaces.localOfflineRowStale'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.localOfflineRowBle'),
    ).toBeInTheDocument();
  });

  it('edit BLE RNode shows Bluetooth address instead of serial stale hint', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'rnode-ble',
            name: 'rnode-c74c3816',
            type: 'rnode',
            enabled: true,
            status: 'down',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
        ]}
        serialPorts={[{ path: '/dev/cu.usbserial-1' }]}
        serialPortPaths={['/dev/cu.usbserial-1']}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.edit' }),
    );

    await waitFor(() => {
      expect(
        screen.getByLabelText('connectionPanel.reticulumInterfaces.rnodeTransportBle'),
      ).toHaveValue('ble://AA:BB:CC:DD:EE:FF');
    });
  });

  it('opens serial device picker from add interface flow', async () => {
    const user = userEvent.setup();
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/serial/ports') {
        return Promise.resolve({ ports: [{ path: '/dev/cu.usbserial-1', label: 'Radio USB' }] });
      }
      if (path === '/api/v1/ble/availability') {
        return Promise.resolve({ available: false });
      }
      if (path === '/api/v1/rnode/presets') {
        return Promise.resolve({ presets: [] });
      }
      if (path === '/api/v1/config/audit') {
        return Promise.resolve({ issues: [] });
      }
      return Promise.resolve({});
    });

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        serialPorts={[{ path: '/dev/cu.usbserial-1', label: 'Radio USB' }]}
        serialPortPaths={['/dev/cu.usbserial-1']}
      />,
    );

    const typeSelect = screen.getByLabelText('connectionPanel.reticulumInterfaces.type');
    await user.selectOptions(typeSelect, 'rnode');
    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.pickDevice' }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', {
          name: 'connectionPanel.reticulumInterfaces.pickerSerialTitle',
        }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Radio USB')).toBeInTheDocument();
  });

  it('opens BLE RNode picker when transport is Bluetooth', async () => {
    const user = userEvent.setup();
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/ble/availability') {
        return Promise.resolve({ available: true });
      }
      if (path === '/api/v1/ble/scan') {
        return Promise.resolve({ devices: [] });
      }
      if (path === '/api/v1/rnode/presets') {
        return Promise.resolve({ presets: [] });
      }
      if (path === '/api/v1/serial/ports') {
        return Promise.resolve({ ports: [] });
      }
      return Promise.resolve({});
    });

    render(<ReticulumInterfacesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyGet).toHaveBeenCalledWith(
        '/api/v1/ble/availability',
      );
    });

    const typeSelect = screen.getByLabelText('connectionPanel.reticulumInterfaces.type');
    await user.selectOptions(typeSelect, 'rnode');
    const transportSelect = screen.getByLabelText(
      'connectionPanel.reticulumInterfaces.rnodeTransport',
    );
    await user.selectOptions(transportSelect, 'ble');
    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.pickDevice' }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', {
          name: 'connectionPanel.reticulumInterfaces.pickerBleRnodeTitle',
        }),
      ).toBeInTheDocument();
    });
  });

  it('does not flag Wi-Fi RNode tcp:// interface rows as stale USB serial ports', () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'rnode-wifi',
            name: 'RNode WiFi',
            type: 'rnode',
            enabled: true,
            status: 'down',
            serial_port: 'tcp://192.168.1.42:7633',
          },
        ]}
        serialPorts={[]}
        serialPortPaths={[]}
      />,
    );

    expect(screen.getByText('connectionPanel.reticulumInterfaces.rowSummary')).toBeInTheDocument();
    expect(
      screen.queryByText('connectionPanel.reticulumInterfaces.localOfflineRowStale'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.localOfflineRowWifi'),
    ).toBeInTheDocument();
  });

  it('posts tcp:// serial_port when adding Wi-Fi RNode transport', async () => {
    const user = userEvent.setup();
    render(<ReticulumInterfacesPanel {...defaultProps} />);

    const typeSelect = screen.getByLabelText('connectionPanel.reticulumInterfaces.type');
    await user.selectOptions(typeSelect, 'rnode');
    const transportSelect = screen.getByLabelText(
      'connectionPanel.reticulumInterfaces.rnodeTransport',
    );
    await user.selectOptions(transportSelect, 'wifi');
    await user.type(
      screen.getByLabelText('connectionPanel.reticulumInterfaces.rnodeWifiHost'),
      '192.168.1.10',
    );
    await user.type(screen.getByLabelText('connectionPanel.reticulumInterfaces.callsign'), 'NV0N');
    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.add' }),
    );

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledWith('/api/v1/interfaces', {
        type: 'rnode',
        serial_port: 'tcp://192.168.1.10',
        preset: 'rnode_us',
        frequency: 914875000,
        bandwidth: 125000,
        spreading_factor: 8,
        coding_rate: 5,
        txpower: 17,
        callsign: 'NV0N',
        name: '192.168.1.10',
      });
    });
  });

  it('edit Wi-Fi RNode shows host and port fields', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'rnode-wifi',
            name: 'rnode-wifi',
            type: 'rnode',
            enabled: true,
            status: 'down',
            serial_port: 'tcp://10.0.0.50',
          },
        ]}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.edit' }),
    );

    await waitFor(() => {
      expect(
        screen.getByLabelText('connectionPanel.reticulumInterfaces.rnodeWifiHost'),
      ).toHaveValue('10.0.0.50');
      expect(
        screen.getByLabelText('connectionPanel.reticulumInterfaces.rnodeWifiPort'),
      ).toHaveValue(String(7633));
    });
  });

  it('does not duplicate disable when audit suggests disable on user-managed interface', async () => {
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/config/audit') {
        return Promise.resolve({
          issues: [
            {
              kind: 'tcp_unreachable',
              severity: 'warning',
              interface_id: 'hub-dublin',
              interface_name: 'RNS Testnet Dublin',
              message: 'unreachable',
              repair_kind: 'disable',
            },
          ],
        });
      }
      if (path === '/api/v1/ble/availability') {
        return Promise.resolve({ available: false });
      }
      if (path === '/api/v1/rnode/presets') {
        return Promise.resolve({ presets: [] });
      }
      return Promise.resolve({});
    });

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'hub-dublin',
            name: 'RNS Testnet Dublin',
            type: 'tcp',
            enabled: true,
            status: 'down',
            host: 'dublin.example',
            port: 4242,
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText('diagnosticsPanel.reticulum.audit.tcp_unreachable'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.disable' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'connectionPanel.reticulumInterfaces.auditDisable' }),
    ).not.toBeInTheDocument();
  });

  it('shows runtime badge and hides edit/delete for SharedInstanceServer', () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'shared',
            name: 'SharedInstanceServer',
            type: 'tcp',
            enabled: true,
            status: 'up',
          },
        ]}
      />,
    );

    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.runtimeBadge'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'connectionPanel.reticulumInterfaces.edit' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'connectionPanel.reticulumInterfaces.delete' }),
    ).not.toBeInTheDocument();
  });

  it('shows primary controls when two enabled local serial interfaces exist', () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        effectivePrimaryLocalSerialInterfaceId="usb-rnode"
        interfaces={[
          {
            id: 'usb-rnode',
            name: 'USB RNode',
            type: 'rnode',
            enabled: true,
            status: 'up',
            serial_port: '/dev/ttyUSB0',
          },
          {
            id: 'ble-rnode',
            name: 'BLE RNode',
            type: 'rnode',
            enabled: true,
            status: 'up',
            serial_port: 'ble://aa:bb:cc:dd:ee:ff',
          },
        ]}
      />,
    );

    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.primaryLocalSummary'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.primaryLocalBadge'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.setPrimaryLocalAria',
      }),
    ).toBeInTheDocument();
  });

  it('hides primary controls with only one enabled local serial interface', () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        effectivePrimaryLocalSerialInterfaceId="usb-rnode"
        interfaces={[
          {
            id: 'usb-rnode',
            name: 'USB RNode',
            type: 'rnode',
            enabled: true,
            status: 'up',
            serial_port: '/dev/ttyUSB0',
          },
        ]}
      />,
    );

    expect(
      screen.queryByText('connectionPanel.reticulumInterfaces.primaryLocalSummary'),
    ).not.toBeInTheDocument();
  });
  it('adds all default hub presets disabled when none are configured', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPost = proxyPost;

    render(<ReticulumInterfacesPanel {...defaultProps} />);

    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.addDefaultHubsAria',
      }),
    );

    await waitFor(() => {
      expect(proxyPost).toHaveBeenCalledTimes(RETICULUM_DEFAULT_HUB_PRESETS.length);
    });
    for (const preset of RETICULUM_DEFAULT_HUB_PRESETS) {
      expect(proxyPost).toHaveBeenCalledWith(
        '/api/v1/interfaces',
        buildDefaultHubAddRequest(preset),
      );
    }
    expect(defaultProps.onRefresh).toHaveBeenCalled();
  });

  it('skips configured presets and adds only missing hubs', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPost = proxyPost;

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'dublin',
            name: 'RNS Testnet Dublin',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: 'dublin.connect.reticulum.network',
            port: 4965,
          },
          {
            id: 'btb',
            name: 'RNS Testnet BetweenTheBorders',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: 'reticulum.betweentheborders.com',
            port: 4242,
          },
          {
            id: 'us-east',
            name: 'RNS_Transport_US-East',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: '45.77.109.86',
            port: 4965,
          },
          {
            id: 'i2p',
            name: 'RNS Testnet I2P Hub A',
            type: 'i2p',
            enabled: false,
            status: 'down',
            host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
          },
        ]}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.addDefaultHubsAria',
      }),
    );

    await waitFor(() => {
      expect(proxyPost).toHaveBeenCalledTimes(2);
    });
    expect(proxyPost).toHaveBeenCalledWith(
      '/api/v1/interfaces',
      buildDefaultHubAddRequest(RETICULUM_DEFAULT_HUB_PRESETS[4]),
    );
    expect(proxyPost).toHaveBeenCalledWith(
      '/api/v1/interfaces',
      buildDefaultHubAddRequest(RETICULUM_DEFAULT_HUB_PRESETS[5]),
    );
  });

  it('shows identity hint and disables default hubs when identity is not configured', () => {
    render(<ReticulumInterfacesPanel {...defaultProps} identityConfigured={false} />);

    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.identityRequiredHint'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.addDefaultHubsAria',
      }),
    ).toBeDisabled();
  });

  it('humanizes identity-not-configured sidecar error when adding default hubs', async () => {
    const user = userEvent.setup();
    window.electronAPI.reticulum.proxyPost = vi
      .fn()
      .mockResolvedValue({ ok: false, error: 'identity not configured' });

    render(<ReticulumInterfacesPanel {...defaultProps} />);

    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.addDefaultHubsAria',
      }),
    );

    expect(
      await screen.findByText('connectionPanel.reticulumInterfaces.identityNotConfigured'),
    ).toBeInTheDocument();
    expect(screen.queryByText('identity not configured')).not.toBeInTheDocument();
  });
});
