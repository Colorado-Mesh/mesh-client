import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { GPS_SETTINGS_STORAGE_KEY } from '@/renderer/lib/gpsSource';
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
import { RETICULUM_BACKBONE_DIRECTORY_URL } from '@/shared/reticulumDecommissionedHubs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { addToastMock, restartStackMock } = vi.hoisted(() => ({
  addToastMock: vi.fn(),
  restartStackMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/renderer/components/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

vi.mock('@/renderer/lib/sessions/reticulumSession', () => ({
  tryGetReticulumSession: () => ({
    restartStack: restartStackMock,
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

const rmapCapableRnode: ReticulumInterfaceRow = {
  id: 'rnode-41f4',
  name: 'RNode 41F4',
  type: 'rnode',
  enabled: true,
  status: 'up',
  serial_port: 'ble://eccf2847-e1fd-3f5f-0811-064db1639a3d',
  discoverable: false,
};

const rmapWorldHub: ReticulumInterfaceRow = {
  id: 'rmap-world',
  name: 'RMAP World',
  type: 'tcp',
  enabled: true,
  status: 'up',
  host: 'rmap.world',
  port: 4242,
};

describe('ReticulumInterfacesPanel', () => {
  beforeEach(() => {
    addToastMock.mockClear();
    restartStackMock.mockClear();
    localStorage.removeItem(GPS_SETTINGS_STORAGE_KEY);
    useConnectionStore.setState({ connections: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    window.electronAPI.reticulum.proxyPost = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyDelete = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.hostLink.probeTcpRtt = vi.fn().mockResolvedValue(42);
    window.electronAPI.bleCoexistence.acquireScan = vi.fn().mockResolvedValue({});
    window.electronAPI.bleCoexistence.releaseScan = vi.fn().mockResolvedValue({});
    hydrateAxeThemeColors(document.documentElement);
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
      if (path === '/api/v1/stack/settings') {
        return Promise.resolve({
          enable_transport: true,
          share_instance: false,
          loglevel: 4,
        });
      }
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({ interfaces: [rmapCapableRnode, rmapWorldHub] });
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

  it('links to the Reticulum backbone directory in the Interfaces body (not nested in summary)', async () => {
    const { container } = render(<ReticulumInterfacesPanel {...defaultProps} />);
    const link = screen.getByRole('link', {
      name: 'connectionPanel.reticulumInterfaces.backboneDirectoryLinkAria',
    });
    expect(link).toHaveAttribute('href', RETICULUM_BACKBONE_DIRECTORY_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.closest('summary')).toBeNull();
    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.backboneEnableGuidanceLead'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.backboneEnableGuidanceBody'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.addDefaultHubs'),
    ).toBeInTheDocument();
    expect(RETICULUM_DEFAULT_HUB_PRESETS.some((p) => p.host.includes('dublin'))).toBe(true);
    expect(RETICULUM_DEFAULT_HUB_PRESETS.some((p) => p.host.includes('betweentheborders'))).toBe(
      true,
    );
    expect(RETICULUM_DEFAULT_HUB_PRESETS.some((p) => p.host.includes('amsterdam'))).toBe(false);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('groups interface rows by backbone region and User Defined', () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'dublin',
            name: 'RNS Dublin Mainnet',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: 'dublin.connect.reticulum.network',
            port: 4965,
            mode: 'boundary',
          },
          {
            id: 'rnode-1',
            name: 'My RNode',
            type: 'rnode',
            enabled: true,
            status: 'up',
            serial_port: '/dev/ttyUSB0',
          },
        ]}
      />,
    );
    expect(screen.getByTestId('reticulum-iface-group-primary_global')).toBeInTheDocument();
    expect(screen.getByTestId('reticulum-iface-group-user_defined')).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.defaultHubRegion.primary_global'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.interfaceListGroup.user_defined'),
    ).toBeInTheDocument();
  });

  it('warns when more than three default backbones are enabled', () => {
    const enabledPresets = RETICULUM_DEFAULT_HUB_PRESETS.filter((p) => p.type === 'tcp').slice(
      0,
      4,
    );
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={enabledPresets.map((preset, index) => ({
          id: `hub-${index}`,
          name: preset.name,
          type: preset.type,
          enabled: true,
          status: 'down',
          host: preset.host,
          port: preset.port,
          mode: 'boundary',
        }))}
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.backboneEnableTooMany'),
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

  it('always shows Signal UI on enabled BLE RNode rows even when RSSI is unknown', () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'rnode-ble',
            name: 'RNode BLE',
            type: 'rnode',
            enabled: true,
            status: 'up',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
        ]}
      />,
    );

    const meter = screen.getByTestId('reticulum-ble-signal-rnode-ble');
    expect(meter).toBeInTheDocument();
    expect(within(meter).getByText('connectionPanel.hostSignalUnavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('reticulum-tcp-link-rnode-ble')).not.toBeInTheDocument();
  });

  it('shows BLE RSSI dBm on enabled BLE RNode rows when scan provides RSSI', async () => {
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/ble/availability') {
        return Promise.resolve({ available: true });
      }
      if (typeof path === 'string' && path.startsWith('/api/v1/ble/scan')) {
        return Promise.resolve({
          devices: [{ address: 'AA:BB:CC:DD:EE:FF', rssi: -63, kind: 'rnode' }],
        });
      }
      if (path === '/api/v1/serial/ports') return Promise.resolve({ ports: [] });
      if (path === '/api/v1/rnode/presets') return Promise.resolve({ presets: [] });
      if (path === '/api/v1/config/audit') return Promise.resolve({ issues: [] });
      if (path === '/api/v1/stack/settings') {
        return Promise.resolve({
          enable_transport: true,
          share_instance: false,
          loglevel: 4,
        });
      }
      return Promise.resolve({});
    });

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'rnode-ble',
            name: 'RNode BLE',
            type: 'rnode',
            enabled: true,
            status: 'up',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(
        within(screen.getByTestId('reticulum-ble-signal-rnode-ble')).getByText(
          'connectionPanel.bleRssiDbm',
        ),
      ).toBeInTheDocument();
    });
  });

  it('seeds BLE RSSI while sidecar is running during connecting (api not ready)', async () => {
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/ble/availability') {
        return Promise.resolve({ available: true });
      }
      if (typeof path === 'string' && path.startsWith('/api/v1/ble/scan')) {
        return Promise.resolve({
          devices: [{ address: 'AA:BB:CC:DD:EE:FF', rssi: -59, kind: 'rnode' }],
        });
      }
      if (path === '/api/v1/serial/ports') return Promise.resolve({ ports: [] });
      if (path === '/api/v1/rnode/presets') return Promise.resolve({ presets: [] });
      if (path === '/api/v1/config/audit') return Promise.resolve({ issues: [] });
      if (path === '/api/v1/stack/settings') {
        return Promise.resolve({
          enable_transport: true,
          share_instance: false,
          loglevel: 4,
        });
      }
      return Promise.resolve({});
    });

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        sidecarApiReady={false}
        sidecarRunning
        connecting
        interfaces={[
          {
            id: 'rnode-ble',
            name: 'RNode BLE',
            type: 'rnode',
            enabled: true,
            status: 'up',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(
        within(screen.getByTestId('reticulum-ble-signal-rnode-ble')).getByText(
          'connectionPanel.bleRssiDbm',
        ),
      ).toBeInTheDocument();
    });
    expect(window.electronAPI.reticulum.proxyGet).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ble/scan'),
    );
  });

  it('shows Link quality on enabled TCP Client rows', async () => {
    render(<ReticulumInterfacesPanel {...defaultProps} interfaces={[rmapWorldHub]} />);

    const meter = screen.getByTestId('reticulum-tcp-link-rmap-world');
    expect(meter).toBeInTheDocument();
    await waitFor(() => {
      expect(within(meter).getByText('connectionPanel.linkQualityMs')).toBeInTheDocument();
    });
    expect(window.electronAPI.hostLink.probeTcpRtt).toHaveBeenCalledWith('rmap.world', 4242);
  });

  it('does not show host-link meters on serial RNode rows', () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'heltec',
            name: 'Heltec V3',
            type: 'rnode',
            enabled: true,
            status: 'up',
            serial_port: '/dev/cu.usbserial-7',
          },
        ]}
        serialPortPaths={['/dev/cu.usbserial-7']}
      />,
    );

    expect(screen.queryByTestId('reticulum-ble-signal-heltec')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reticulum-tcp-link-heltec')).not.toBeInTheDocument();
  });

  it('hides Signal UI when BLE RNode interface is disabled', () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'rnode-ble',
            name: 'RNode BLE',
            type: 'rnode',
            enabled: false,
            status: 'down',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
        ]}
      />,
    );
    expect(screen.queryByTestId('reticulum-ble-signal-rnode-ble')).not.toBeInTheDocument();
  });

  it('shows Link quality unavailable when TCP probe fails', async () => {
    window.electronAPI.hostLink.probeTcpRtt = vi.fn().mockResolvedValue(null);
    render(<ReticulumInterfacesPanel {...defaultProps} interfaces={[rmapWorldHub]} />);
    const meter = screen.getByTestId('reticulum-tcp-link-rmap-world');
    await waitFor(() => {
      expect(within(meter).getByText('connectionPanel.linkQualityUnavailable')).toBeInTheDocument();
    });
  });

  it('hides Link quality when TCP Client interface is disabled', () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[{ ...rmapWorldHub, enabled: false }]}
      />,
    );
    expect(screen.queryByTestId('reticulum-tcp-link-rmap-world')).not.toBeInTheDocument();
  });

  it('shows both BLE Signal and TCP Link quality when both interface types are enabled', async () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'rnode-ble',
            name: 'RNode BLE',
            type: 'rnode',
            enabled: true,
            status: 'up',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
          rmapWorldHub,
        ]}
      />,
    );
    expect(screen.getByTestId('reticulum-ble-signal-rnode-ble')).toBeInTheDocument();
    expect(screen.getByTestId('reticulum-tcp-link-rmap-world')).toBeInTheDocument();
    await waitFor(() => {
      expect(
        within(screen.getByTestId('reticulum-tcp-link-rmap-world')).getByText(
          'connectionPanel.linkQualityMs',
        ),
      ).toBeInTheDocument();
    });
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

  it('shows rnodeTransportBleHint only for BLE transport', async () => {
    const user = userEvent.setup();
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/ble/availability') {
        return Promise.resolve({ available: true });
      }
      if (path === '/api/v1/rnode/presets') {
        return Promise.resolve({ presets: [] });
      }
      if (path === '/api/v1/config/audit') {
        return Promise.resolve({ issues: [] });
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

    await user.selectOptions(transportSelect, 'serial');
    expect(
      screen.queryByText('connectionPanel.reticulumInterfaces.rnodeTransportBleHint'),
    ).not.toBeInTheDocument();

    await user.selectOptions(transportSelect, 'ble');
    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.rnodeTransportBleHint'),
    ).toBeInTheDocument();

    await user.selectOptions(transportSelect, 'wifi');
    expect(
      screen.queryByText('connectionPanel.reticulumInterfaces.rnodeTransportBleHint'),
    ).not.toBeInTheDocument();
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
        flow_control: true,
        preset: 'rnode_us',
        frequency: 914875000,
        bandwidth: 125000,
        spreading_factor: 8,
        coding_rate: 5,
        txpower: 17,
        callsign: 'NV0N',
        name: '192.168.1.10',
        mode: 'access_point',
      });
    });
  });

  it('posts boundary mode when adding a TCP interface', async () => {
    const user = userEvent.setup();
    render(<ReticulumInterfacesPanel {...defaultProps} />);

    await user.type(
      screen.getByLabelText('connectionPanel.reticulumInterfaces.host'),
      'example.org',
    );
    expect(screen.getByLabelText('connectionPanel.reticulumInterfaces.modeAria')).toHaveValue(
      'boundary',
    );
    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.add' }),
    );

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledWith(
        '/api/v1/interfaces',
        expect.objectContaining({
          type: 'tcp',
          host: 'example.org',
          mode: 'boundary',
        }),
      );
    });
  });

  it('includes mode in edit save patch', async () => {
    const user = userEvent.setup();
    const proxyPut = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPut = proxyPut;

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'hub',
            name: 'Hub',
            type: 'tcp',
            enabled: true,
            status: 'up',
            host: 'example.org',
            port: 4242,
            mode: 'boundary',
          },
        ]}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.edit' }),
    );
    const modeSelect = document.getElementById('edit-mode-hub');
    expect(modeSelect).toBeTruthy();
    await user.selectOptions(modeSelect!, 'gateway');
    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.saveEdit' }),
    );

    await waitFor(() => {
      expect(proxyPut).toHaveBeenCalledWith(
        '/api/v1/interfaces/hub',
        expect.objectContaining({ mode: 'gateway' }),
      );
    });
  });

  it('resets recommended mode when switching add interface type', async () => {
    const user = userEvent.setup();
    render(<ReticulumInterfacesPanel {...defaultProps} />);

    expect(screen.getByLabelText('connectionPanel.reticulumInterfaces.modeAria')).toHaveValue(
      'boundary',
    );
    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.modeDescriptions.boundary'),
    ).toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText('connectionPanel.reticulumInterfaces.type'),
      'rnode',
    );
    expect(screen.getByLabelText('connectionPanel.reticulumInterfaces.modeAria')).toHaveValue(
      'access_point',
    );
    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.modeDescriptions.access_point'),
    ).toBeInTheDocument();
  });

  it('keeps Add interface outside the Mode select so description cannot overlap the button', async () => {
    const { container } = render(<ReticulumInterfacesPanel {...defaultProps} />);

    const mode = screen.getByLabelText('connectionPanel.reticulumInterfaces.modeAria');
    const add = screen.getByRole('button', {
      name: 'connectionPanel.reticulumInterfaces.add',
    });
    const description = screen.getByText(
      'connectionPanel.reticulumInterfaces.modeDescriptions.boundary',
    );

    expect(mode.closest('div')).not.toContainElement(add);
    expect(mode.closest('div')).not.toContainElement(description);
    expect(
      add.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();

    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('clears mode on edit save when empty option selected', async () => {
    const user = userEvent.setup();
    const proxyPut = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPut = proxyPut;

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'hub',
            name: 'Hub',
            type: 'tcp',
            enabled: true,
            status: 'up',
            host: 'example.org',
            port: 4242,
            mode: 'boundary',
          },
        ]}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.edit' }),
    );
    const modeSelect = document.getElementById('edit-mode-hub');
    expect(modeSelect).toBeTruthy();
    await user.selectOptions(modeSelect!, '');
    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.saveEdit' }),
    );

    await waitFor(() => {
      expect(proxyPut).toHaveBeenCalledWith(
        '/api/v1/interfaces/hub',
        expect.objectContaining({ mode: '' }),
      );
    });
  });

  it('posts IFAC fields when adding a TCP interface', async () => {
    const user = userEvent.setup();
    render(<ReticulumInterfacesPanel {...defaultProps} />);

    await user.type(
      screen.getByLabelText('connectionPanel.reticulumInterfaces.host'),
      'private.example',
    );
    await user.type(
      screen.getByLabelText('connectionPanel.reticulumInterfaces.networkNameAria'),
      'private_ret',
    );
    await user.type(
      screen.getByLabelText('connectionPanel.reticulumInterfaces.passphraseAria'),
      'secret-pass',
    );
    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.add' }),
    );

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledWith(
        '/api/v1/interfaces',
        expect.objectContaining({
          type: 'tcp',
          host: 'private.example',
          network_name: 'private_ret',
          passphrase: 'secret-pass',
        }),
      );
    });
  });

  it('prefills IFAC and advanced fields when opening edit', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'ttp-tcp',
            name: 'TTP_TCP',
            type: 'tcp',
            enabled: true,
            status: 'up',
            host: 'rns.thetechprepper.com',
            port: 11312,
            mode: 'boundary',
            network_name: 'ttp_internal',
            passphrase: 'resistance202606',
            extra_config: { forward_interval: '300' },
          },
        ]}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.edit' }),
    );
    expect(document.getElementById('edit-ifac-ttp-tcp-network-name')).toHaveValue('ttp_internal');
    expect(document.getElementById('edit-ifac-ttp-tcp-passphrase')).toHaveValue('resistance202606');
    expect(document.getElementById('edit-advanced-ttp-tcp')).toHaveValue('forward_interval = 300');
  });

  it('includes IFAC and extra_config in edit save patch', async () => {
    const user = userEvent.setup();
    const proxyPut = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPut = proxyPut;

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'hub',
            name: 'Hub',
            type: 'tcp',
            enabled: true,
            status: 'up',
            host: 'example.org',
            port: 4242,
            mode: 'boundary',
            network_name: 'old_net',
            passphrase: 'old_pass',
            extra_config: { forward_interval: '100' },
          },
        ]}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.edit' }),
    );
    const networkInput = document.getElementById('edit-ifac-hub-network-name');
    expect(networkInput).toBeTruthy();
    await user.clear(networkInput!);
    await user.type(networkInput!, 'new_net');
    const advanced = document.getElementById('edit-advanced-hub');
    expect(advanced).toBeTruthy();
    await user.clear(advanced!);
    await user.type(
      advanced!,
      'forward_interval = 300{Enter}max_distance = 50{Enter}network_name = ignore',
    );
    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.saveEdit' }),
    );

    await waitFor(() => {
      expect(proxyPut).toHaveBeenCalledWith(
        '/api/v1/interfaces/hub',
        expect.objectContaining({
          network_name: 'new_net',
          passphrase: 'old_pass',
          extra_config: {
            forward_interval: '300',
            max_distance: '50',
          },
        }),
      );
    });
  });

  it('shows row summary with mode when interface has a mode', () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'hub',
            name: 'Hub',
            type: 'tcp',
            enabled: true,
            status: 'up',
            host: 'example.org',
            port: 4242,
            mode: 'boundary',
          },
        ]}
      />,
    );

    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.rowSummaryWithMode'),
    ).toBeInTheDocument();
  });

  it('keeps empty mode on edit for legacy interfaces without inventing a default', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'hub',
            name: 'Hub',
            type: 'tcp',
            enabled: true,
            status: 'up',
            host: 'example.org',
            port: 4242,
          },
        ]}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.edit' }),
    );
    expect(document.getElementById('edit-mode-hub')).toHaveValue('');
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
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.disableAria' }),
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
    expect(screen.queryByTestId('reticulum-iface-select-shared')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reticulum-iface-selection-toolbar')).not.toBeInTheDocument();
  });

  it('mutes disabled interface rows and keeps enabled rows full contrast', () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'hub-on',
            name: 'RNS Beleth',
            type: 'tcp',
            enabled: true,
            status: 'up',
            host: 'rns.beleth.net',
            port: 4242,
            mode: 'boundary',
          },
          {
            id: 'hub-off',
            name: 'RNS AceHoss',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: 'rns.acehoss.net',
            port: 4242,
            mode: 'boundary',
          },
        ]}
      />,
    );

    expect(screen.getByTestId('reticulum-iface-row-hub-on')).toHaveAttribute(
      'data-enabled',
      'true',
    );
    expect(screen.getByTestId('reticulum-iface-row-hub-off')).toHaveAttribute(
      'data-enabled',
      'false',
    );
    expect(
      screen.getByTestId('reticulum-iface-row-hub-off').querySelector('.text-gray-500'),
    ).not.toBeNull();
    expect(
      screen.getByTestId('reticulum-iface-row-hub-on').querySelector('.text-gray-500'),
    ).toBeNull();
  });

  it('selects deletable interfaces and bulk-deletes via confirm', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const proxyDelete = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyDelete = proxyDelete;

    const { container } = render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        onRefresh={onRefresh}
        interfaces={[
          {
            id: 'hub-a',
            name: 'RNS Beleth',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: 'rns.beleth.net',
            port: 4242,
            mode: 'boundary',
          },
          {
            id: 'hub-b',
            name: 'RNS AceHoss',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: 'rns.acehoss.net',
            port: 4242,
            mode: 'boundary',
          },
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

    expect(screen.getByTestId('reticulum-iface-select-hub-a')).toBeInTheDocument();
    expect(screen.getByTestId('reticulum-iface-select-hub-b')).toBeInTheDocument();
    expect(screen.queryByTestId('reticulum-iface-select-shared')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.selectAllAria' }),
    );
    expect(screen.getByTestId('reticulum-iface-select-hub-a')).toBeChecked();
    expect(screen.getByTestId('reticulum-iface-select-hub-b')).toBeChecked();

    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.deleteSelectedAria',
      }),
    );
    expect(
      await screen.findByText('connectionPanel.reticulumInterfaces.deleteSelectedConfirmTitle'),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.deleteSelectedConfirm',
      }),
    );

    await waitFor(() => {
      expect(proxyDelete).toHaveBeenCalledTimes(2);
    });
    expect(proxyDelete).toHaveBeenCalledWith('/api/v1/interfaces/hub-a');
    expect(proxyDelete).toHaveBeenCalledWith('/api/v1/interfaces/hub-b');
    expect(onRefresh).toHaveBeenCalled();

    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('surfaces partial bulk-delete failure and still refreshes after successes', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const proxyDelete = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: 'busy' });
    window.electronAPI.reticulum.proxyDelete = proxyDelete;

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        onRefresh={onRefresh}
        interfaces={[
          {
            id: 'hub-a',
            name: 'RNS Beleth',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: 'rns.beleth.net',
            port: 4242,
            mode: 'boundary',
          },
          {
            id: 'hub-b',
            name: 'RNS AceHoss',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: 'rns.acehoss.net',
            port: 4242,
            mode: 'boundary',
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId('reticulum-iface-select-hub-a'));
    await user.click(screen.getByTestId('reticulum-iface-select-hub-b'));
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.deleteSelectedAria',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.deleteSelectedConfirm',
      }),
    );

    await waitFor(() => {
      expect(proxyDelete).toHaveBeenCalledTimes(2);
    });
    expect(onRefresh).toHaveBeenCalled();
    expect(
      await screen.findByText('connectionPanel.reticulumInterfaces.deleteSelectedPartialFailed'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('reticulum-iface-select-hub-b')).toBeChecked();
  });

  it('does not refresh when every bulk delete fails', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    window.electronAPI.reticulum.proxyDelete = vi.fn().mockResolvedValue({ ok: false });

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        onRefresh={onRefresh}
        interfaces={[
          {
            id: 'hub-a',
            name: 'RNS Beleth',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: 'rns.beleth.net',
            port: 4242,
            mode: 'boundary',
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId('reticulum-iface-select-hub-a'));
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.deleteSelectedAria',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.deleteSelectedConfirm',
      }),
    );

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyDelete).toHaveBeenCalled();
    });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(restartStackMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText('connectionPanel.reticulumInterfaces.deleteSelectedPartialFailed'),
    ).toBeInTheDocument();
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
  it('opens hub picker and adds Primary & Global presets by default', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPost = proxyPost;
    const primary = RETICULUM_DEFAULT_HUB_PRESETS.filter((p) => p.region === 'primary_global');

    render(<ReticulumInterfacesPanel {...defaultProps} />);

    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.addDefaultHubsAria',
      }),
    );
    expect(
      screen.getByRole('dialog', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubsPickerTitle',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubRegion.primary_global',
      }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubRegion.specialty',
      }),
    ).not.toBeChecked();

    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubsPickerConfirmAria',
      }),
    );

    await waitFor(() => {
      expect(proxyPost).toHaveBeenCalledTimes(primary.length);
    });
    for (const preset of primary) {
      expect(proxyPost).toHaveBeenCalledWith(
        '/api/v1/interfaces',
        buildDefaultHubAddRequest(preset),
      );
    }
    expect(defaultProps.onRefresh).toHaveBeenCalled();
  });

  it('cancels hub picker without calling the API', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPost = proxyPost;

    render(<ReticulumInterfacesPanel {...defaultProps} />);

    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.addDefaultHubsAria',
      }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'connectionPanel.reticulumInterfaces.defaultHubsPickerTitle',
    });
    await user.click(within(dialog).getByRole('button', { name: 'common.cancel' }));
    expect(proxyPost).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('dialog', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubsPickerTitle',
      }),
    ).not.toBeInTheDocument();
  });

  it('adds Primary & Global plus North America when both regions are selected', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPost = proxyPost;
    const expected = RETICULUM_DEFAULT_HUB_PRESETS.filter(
      (p) => p.region === 'primary_global' || p.region === 'north_america',
    );

    render(<ReticulumInterfacesPanel {...defaultProps} />);

    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.addDefaultHubsAria',
      }),
    );
    await user.click(
      screen.getByRole('checkbox', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubRegion.north_america',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubsPickerConfirmAria',
      }),
    );

    await waitFor(() => {
      expect(proxyPost).toHaveBeenCalledTimes(expected.length);
    });
    for (const preset of expected) {
      expect(proxyPost).toHaveBeenCalledWith(
        '/api/v1/interfaces',
        buildDefaultHubAddRequest(preset),
      );
    }
    expect(window.electronAPI.reticulum.proxyPut).not.toHaveBeenCalled();
  });

  it('shows a red decommissioned badge on decommissioned TCP hub rows', () => {
    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'rns-testnet-amsterdam',
            name: 'RNS Testnet Amsterdam',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: 'amsterdam.connect.reticulum.network',
            port: 4965,
            mode: 'boundary',
          },
        ]}
      />,
    );

    expect(screen.getByTestId('reticulum-decommissioned-rns-testnet-amsterdam')).toHaveTextContent(
      'connectionPanel.reticulumInterfaces.decommissionedBadge',
    );
  });

  it('blocks enabling a decommissioned hub without calling enable or restarting', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPost = proxyPost;

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'rns-testnet-amsterdam',
            name: 'RNS Testnet Amsterdam',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: 'amsterdam.connect.reticulum.network',
            port: 4965,
            mode: 'boundary',
          },
        ]}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.enableAria' }),
    );

    expect(
      await screen.findByText('connectionPanel.reticulumInterfaces.decommissionedHubEnableBlocked'),
    ).toBeInTheDocument();
    expect(proxyPost).not.toHaveBeenCalledWith(
      '/api/v1/interfaces/rns-testnet-amsterdam/enable',
      expect.anything(),
    );
  });

  it('disables decommissioned hubs and adds selected Primary & Global presets', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    const proxyPut = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPost = proxyPost;
    window.electronAPI.reticulum.proxyPut = proxyPut;
    const primary = RETICULUM_DEFAULT_HUB_PRESETS.filter((p) => p.region === 'primary_global');

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'ams',
            name: 'RNS Testnet Amsterdam',
            type: 'tcp',
            enabled: true,
            status: 'down',
            host: 'amsterdam.connect.reticulum.network',
            port: 4965,
            mode: 'boundary',
          },
          {
            id: 'us-east',
            name: 'RNS_Transport_US-East',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: '45.77.109.86',
            port: 4965,
            mode: 'boundary',
          },
        ]}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.addDefaultHubsAria',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubsPickerConfirmAria',
      }),
    );

    await waitFor(() => {
      expect(proxyPut).toHaveBeenCalledTimes(1);
      expect(proxyPost).toHaveBeenCalledTimes(primary.length);
    });
    expect(proxyPut).toHaveBeenCalledWith('/api/v1/interfaces/ams', { enabled: false });
    expect(defaultProps.onRefresh).toHaveBeenCalled();
  });

  it('repairs only when all endpoints exist but a preset name is wrong', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    const proxyPut = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPost = proxyPost;
    window.electronAPI.reticulum.proxyPut = proxyPut;
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        onRefresh={onRefresh}
        interfaces={RETICULUM_DEFAULT_HUB_PRESETS.map((preset, index) => ({
          id: `hub-${index}`,
          name: preset.id === 'dublin-mainnet' ? 'Wrong Dublin Name' : preset.name,
          type: preset.type,
          enabled: false,
          status: 'down',
          host: preset.host,
          port: preset.port,
          mode: 'boundary',
        }))}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.addDefaultHubsAria',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubsPickerConfirmAria',
      }),
    );

    await waitFor(() => {
      expect(proxyPut).toHaveBeenCalledTimes(1);
    });
    expect(proxyPost).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
  });

  it('does nothing when selected default hubs are fully configured', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    const proxyPut = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPost = proxyPost;
    window.electronAPI.reticulum.proxyPut = proxyPut;
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        onRefresh={onRefresh}
        interfaces={RETICULUM_DEFAULT_HUB_PRESETS.map((preset, index) => ({
          id: `hub-${index}`,
          name: preset.name,
          type: preset.type,
          enabled: false,
          status: 'down',
          host: preset.host,
          port: preset.port,
          mode: 'boundary',
        }))}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.addDefaultHubsAria',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubsPickerConfirmAria',
      }),
    );

    expect(proxyPost).not.toHaveBeenCalled();
    expect(proxyPut).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('continues sync when default hub repair fails', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    const proxyPut = vi.fn().mockResolvedValue({ ok: false, error: 'repair failed' });
    window.electronAPI.reticulum.proxyPost = proxyPost;
    window.electronAPI.reticulum.proxyPut = proxyPut;

    render(
      <ReticulumInterfacesPanel
        {...defaultProps}
        interfaces={[
          {
            id: 'dublin',
            name: 'Custom Dublin',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: 'dublin.connect.reticulum.network',
            port: 4965,
          },
        ]}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.addDefaultHubsAria',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubsPickerConfirmAria',
      }),
    );

    await waitFor(() => {
      expect(proxyPut).toHaveBeenCalledTimes(1);
      expect(proxyPost).toHaveBeenCalled();
    });
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
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubsPickerConfirmAria',
      }),
    );

    expect(
      await screen.findByText('connectionPanel.reticulumInterfaces.identityNotConfigured'),
    ).toBeInTheDocument();
    expect(screen.queryByText('identity not configured')).not.toBeInTheDocument();
  });

  describe('RMAP discoverable toggle restart confirm', () => {
    beforeEach(() => {
      localStorage.setItem(
        GPS_SETTINGS_STORAGE_KEY,
        JSON.stringify({ staticLat: 40.19444, staticLon: -105.06722 }),
      );
    });

    it.each([
      {
        id: 'rnode-1',
        name: 'RNode USB',
        type: 'rnode',
        serial_port: '/dev/ttyUSB0',
      },
      {
        id: 'rnode-multi-1',
        name: 'RNode Multi',
        type: 'rnode_multi',
        serial_port: '/dev/ttyUSB1',
      },
      {
        id: 'kiss-1',
        name: 'KISS',
        type: 'kiss',
        serial_port: '/dev/kiss',
      },
      { id: 'ble-1', name: 'BLE Peer', type: 'ble_peer' },
      { id: 'i2p-1', name: 'I2P', type: 'i2p' },
      { id: 'udp-1', name: 'UDP', type: 'udp' },
      { id: 'pipe-1', name: 'Pipe', type: 'pipe' },
    ] as const)('shows RMAP checkbox for eligible $type', (partial) => {
      render(
        <ReticulumInterfacesPanel
          {...defaultProps}
          interfaces={[{ ...partial, enabled: true, status: 'up', discoverable: false }]}
        />,
      );
      expect(
        screen.getByRole('checkbox', {
          name: 'connectionPanel.reticulumInterfaces.rmapDiscoverableAria',
        }),
      ).toBeInTheDocument();
    });

    it('hides RMAP checkbox for tcp hubs and system-managed rows', () => {
      render(
        <ReticulumInterfacesPanel
          {...defaultProps}
          interfaces={[
            rmapWorldHub,
            {
              id: 'shared',
              name: 'SharedInstanceServer',
              type: 'rnode',
              enabled: true,
              status: 'up',
              serial_port: '/dev/ttyUSB0',
            },
            {
              id: 'auto-1',
              name: 'Default Interface',
              type: 'auto',
              enabled: true,
              status: 'up',
            },
          ]}
        />,
      );
      expect(
        screen.queryByRole('checkbox', {
          name: 'connectionPanel.reticulumInterfaces.rmapDiscoverableAria',
        }),
      ).not.toBeInTheDocument();
    });

    it('refreshes then shows restart confirm; confirm restarts the stack', async () => {
      const user = userEvent.setup();
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      render(
        <ReticulumInterfacesPanel
          {...defaultProps}
          onRefresh={onRefresh}
          interfaces={[rmapCapableRnode, rmapWorldHub]}
        />,
      );

      await user.click(
        screen.getByRole('checkbox', {
          name: 'connectionPanel.reticulumInterfaces.rmapDiscoverableAria',
        }),
      );

      await waitFor(() => {
        expect(onRefresh).toHaveBeenCalled();
      });
      expect(await screen.findByText('reticulumRmapDiscovery.restartTitle')).toBeInTheDocument();
      expect(restartStackMock).not.toHaveBeenCalled();

      const dialog = screen.getByRole('alertdialog');
      await user.click(
        within(dialog).getByRole('button', { name: 'reticulumRmapDiscovery.restartConfirm' }),
      );

      await waitFor(() => {
        expect(restartStackMock).toHaveBeenCalled();
      });
      expect(screen.queryByText('reticulumRmapDiscovery.restartTitle')).not.toBeInTheDocument();
    });

    it('cancel closes restart confirm and shows the restart hint', async () => {
      const user = userEvent.setup();
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      render(
        <ReticulumInterfacesPanel
          {...defaultProps}
          onRefresh={onRefresh}
          interfaces={[rmapCapableRnode, rmapWorldHub]}
        />,
      );

      await user.click(
        screen.getByRole('checkbox', {
          name: 'connectionPanel.reticulumInterfaces.rmapDiscoverableAria',
        }),
      );

      expect(await screen.findByText('reticulumRmapDiscovery.restartTitle')).toBeInTheDocument();

      const dialog = screen.getByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'common.cancel' }));

      expect(screen.queryByText('reticulumRmapDiscovery.restartTitle')).not.toBeInTheDocument();
      expect(
        screen.getByText('connectionPanel.reticulumInterfaces.restartStackHint'),
      ).toBeInTheDocument();
      expect(restartStackMock).not.toHaveBeenCalled();
    });

    it('still shows restart confirm when onRefresh rejects after a successful toggle', async () => {
      const user = userEvent.setup();
      const onRefresh = vi.fn().mockRejectedValue(new Error('refresh failed'));

      render(
        <ReticulumInterfacesPanel
          {...defaultProps}
          onRefresh={onRefresh}
          interfaces={[rmapCapableRnode, rmapWorldHub]}
        />,
      );

      await user.click(
        screen.getByRole('checkbox', {
          name: 'connectionPanel.reticulumInterfaces.rmapDiscoverableAria',
        }),
      );

      expect(await screen.findByText('reticulumRmapDiscovery.restartTitle')).toBeInTheDocument();
      expect(addToastMock).toHaveBeenCalledWith(
        'connectionPanel.reticulumInterfaces.rmapEnableSuccess',
        'success',
      );
      expect(addToastMock).not.toHaveBeenCalledWith(
        expect.stringContaining('rmapToggleFailed'),
        'error',
      );
    });
  });

  describe('flow control', () => {
    it('shows a checked flow-control checkbox and posts flow_control: true when adding an RNode', async () => {
      const user = userEvent.setup();
      const proxyPost = vi.fn().mockResolvedValue({ ok: true });
      window.electronAPI.reticulum.proxyPost = proxyPost;

      render(<ReticulumInterfacesPanel {...defaultProps} />);

      await user.selectOptions(
        screen.getByLabelText('connectionPanel.reticulumInterfaces.type'),
        'rnode',
      );
      const flowControl = screen.getByRole('checkbox', {
        name: 'connectionPanel.reticulumInterfaces.flowControl',
      });
      expect(flowControl).toBeChecked();
      await user.type(
        screen.getByLabelText('connectionPanel.reticulumInterfaces.callsign'),
        'NV0N',
      );
      await user.click(
        screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.add' }),
      );

      await waitFor(() => {
        expect(proxyPost).toHaveBeenCalledWith(
          '/api/v1/interfaces',
          expect.objectContaining({ type: 'rnode', flow_control: true }),
        );
      });
    });

    it('does not show a flow-control checkbox for TCP add', () => {
      render(<ReticulumInterfacesPanel {...defaultProps} />);
      expect(
        screen.queryByRole('checkbox', {
          name: 'connectionPanel.reticulumInterfaces.flowControl',
        }),
      ).not.toBeInTheDocument();
    });

    it.each([
      { serial_port: '/dev/ttyUSB0', label: 'serial RNode' },
      { serial_port: 'ble://AA:BB:CC:DD:EE:FF', label: 'BLE RNode' },
      { serial_port: 'tcp://192.168.1.50', label: 'Wi-Fi RNode' },
    ])('shows the flow-control checkbox when editing a $label', async ({ serial_port }) => {
      const user = userEvent.setup();
      render(
        <ReticulumInterfacesPanel
          {...defaultProps}
          interfaces={[
            {
              id: 'rnode-1',
              name: 'RNode',
              type: 'rnode',
              enabled: true,
              status: 'up',
              serial_port,
              callsign: 'NV0N',
              flow_control: true,
            },
          ]}
        />,
      );

      await user.click(
        screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.edit' }),
      );
      expect(
        screen.getByRole('checkbox', {
          name: 'connectionPanel.reticulumInterfaces.flowControl',
        }),
      ).toBeChecked();
    });

    it('reflects flow_control: false from the row and posts flow_control: false when saving', async () => {
      const user = userEvent.setup();
      const proxyPut = vi.fn().mockResolvedValue({ ok: true });
      window.electronAPI.reticulum.proxyPut = proxyPut;

      render(
        <ReticulumInterfacesPanel
          {...defaultProps}
          interfaces={[
            {
              id: 'rnode-1',
              name: 'RNode',
              type: 'rnode',
              enabled: true,
              status: 'up',
              serial_port: '/dev/ttyUSB0',
              callsign: 'NV0N',
              flow_control: true,
            },
          ]}
        />,
      );

      await user.click(
        screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.edit' }),
      );
      const flowControl = screen.getByRole('checkbox', {
        name: 'connectionPanel.reticulumInterfaces.flowControl',
      });
      expect(flowControl).toBeChecked();
      await user.click(flowControl);
      await user.click(
        screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.saveEdit' }),
      );

      await waitFor(() => {
        expect(proxyPut).toHaveBeenCalledWith(
          '/api/v1/interfaces/rnode-1',
          expect.objectContaining({ flow_control: false }),
        );
      });
      const patch = proxyPut.mock.calls[0][1] as Record<string, unknown>;
      // Typed field only — never leaked into the Advanced extra_config bag.
      expect((patch.extra_config as Record<string, string>).flow_control).toBeUndefined();
    });

    it('does not show a flow-control checkbox when editing a TCP hub', async () => {
      const user = userEvent.setup();
      render(
        <ReticulumInterfacesPanel
          {...defaultProps}
          interfaces={[
            {
              id: 'hub',
              name: 'Hub',
              type: 'tcp',
              enabled: true,
              status: 'up',
              host: 'example.org',
              port: 4242,
            },
          ]}
        />,
      );

      await user.click(
        screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.edit' }),
      );
      expect(
        screen.queryByRole('checkbox', {
          name: 'connectionPanel.reticulumInterfaces.flowControl',
        }),
      ).not.toBeInTheDocument();
    });
  });
});
