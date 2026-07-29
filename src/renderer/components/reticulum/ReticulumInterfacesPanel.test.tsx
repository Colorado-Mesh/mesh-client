import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
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
    expect(RETICULUM_DEFAULT_HUB_PRESETS.some((p) => p.host.includes('dublin'))).toBe(false);
    expect(RETICULUM_DEFAULT_HUB_PRESETS.some((p) => p.host.includes('betweentheborders'))).toBe(
      false,
    );
    expect(await axe(container)).toHaveNoViolations();
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
            id: 'us-east',
            name: 'RNS_Transport_US-East',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: '45.77.109.86',
            port: 4965,
            mode: 'boundary',
          },
          {
            id: 'i2p',
            name: 'RNS I2P Hub A',
            type: 'i2p',
            enabled: false,
            status: 'down',
            host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
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

    await waitFor(() => {
      expect(proxyPost).toHaveBeenCalledTimes(3);
    });
    expect(proxyPost).toHaveBeenCalledWith(
      '/api/v1/interfaces',
      buildDefaultHubAddRequest(
        RETICULUM_DEFAULT_HUB_PRESETS.find((p) => p.id === 'yggdrasil-ashburn-va')!,
      ),
    );
    expect(proxyPost).toHaveBeenCalledWith(
      '/api/v1/interfaces',
      buildDefaultHubAddRequest(RETICULUM_DEFAULT_HUB_PRESETS.find((p) => p.id === 'ratspeak')!),
    );
    expect(proxyPost).toHaveBeenCalledWith(
      '/api/v1/interfaces',
      buildDefaultHubAddRequest(RETICULUM_DEFAULT_HUB_PRESETS.find((p) => p.id === 'rmap-world')!),
    );
    expect(window.electronAPI.reticulum.proxyPut).not.toHaveBeenCalled();
  });

  it('disables decommissioned hubs and adds missing backbone presets', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    const proxyPut = vi.fn().mockResolvedValue({ ok: true });
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
            enabled: true,
            status: 'down',
            host: 'dublin.connect.reticulum.network',
            port: 4965,
            mode: 'boundary',
          },
          {
            id: 'btb',
            name: 'RNS Testnet BetweenTheBorders',
            type: 'tcp',
            enabled: true,
            status: 'down',
            host: 'reticulum.betweentheborders.com',
            port: 4242,
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
          {
            id: 'i2p',
            name: 'RNS I2P Hub A',
            type: 'i2p',
            enabled: false,
            status: 'down',
            host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
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

    await waitFor(() => {
      expect(proxyPut).toHaveBeenCalledTimes(2);
      expect(proxyPost).toHaveBeenCalledTimes(3);
    });
    expect(proxyPut).toHaveBeenCalledWith('/api/v1/interfaces/dublin', { enabled: false });
    expect(proxyPut).toHaveBeenCalledWith('/api/v1/interfaces/btb', { enabled: false });
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
          name: index === 0 ? 'Wrong US East Name' : preset.name,
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

    await waitFor(() => {
      expect(proxyPut).toHaveBeenCalledTimes(1);
    });
    expect(proxyPost).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
  });

  it('does nothing when all default hubs are fully configured', async () => {
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
            id: 'us-east',
            name: 'Custom US East',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: '45.77.109.86',
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

    expect(
      await screen.findByText('connectionPanel.reticulumInterfaces.identityNotConfigured'),
    ).toBeInTheDocument();
    expect(screen.queryByText('identity not configured')).not.toBeInTheDocument();
  });
});
