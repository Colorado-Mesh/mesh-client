import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setConnection, useConnectionStore } from '@/renderer/stores/connectionStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/lib/reticulum/useReticulumSidecarApi', () => ({
  useReticulumSidecarApi: () => ({
    sidecarApiReady: true,
    identity: { configured: true, identity_hash: 'abc', lxmf_hash: 'def' },
    statsSummary: null,
    appInfo: null,
    refreshIdentity: vi.fn(),
  }),
}));

vi.mock('../stores/reticulumPeerStore', () => ({
  refreshReticulumPeersFromSidecar: vi.fn().mockResolvedValue([]),
  useReticulumPeerStore: (selector: (s: { peers: Map<string, unknown> }) => unknown) =>
    selector({ peers: new Map([['a', {}]]) }),
}));

import { ReticulumRadioPanel } from './ReticulumRadioPanel';

function mockReticulumProxyGet(overrides: Partial<Record<string, unknown>> = {}): void {
  window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
    if (path === '/api/v1/stack/settings') {
      return Promise.resolve({
        enable_transport: true,
        share_instance: true,
        loglevel: 3,
        announce_interval_sec: 600,
      });
    }
    if (path === '/api/v1/interfaces') {
      return Promise.resolve({ interfaces: overrides.interfaces ?? [] });
    }
    if (path === '/api/v1/serial/ports') {
      return Promise.resolve({ ports: overrides.serialPorts ?? [] });
    }
    if (path === '/api/v1/ble/availability') {
      return Promise.resolve({ available: overrides.bleAvailable ?? false });
    }
    if (path === '/api/v1/ble/scan') {
      return Promise.resolve({ devices: overrides.bleDevices ?? [] });
    }
    return Promise.resolve({});
  });
}

describe('ReticulumRadioPanel', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    mockReticulumProxyGet();
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({ ok: true });
  });

  it('does not render flasher or factory reset sections', () => {
    render(<ReticulumRadioPanel connecting={false} onStartStack={async () => {}} />);

    expect(screen.queryByText('flasher.title')).not.toBeInTheDocument();
    expect(screen.queryByText('radioPanel.reticulumFactoryReset.title')).not.toBeInTheDocument();
  });

  it('preserves announce_interval_sec when saving stack settings', async () => {
    const user = userEvent.setup();
    render(<ReticulumRadioPanel connecting={false} onStartStack={async () => {}} />);

    await user.click(screen.getByText('radioPanel.reticulumStackSettings.save'));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith('/api/v1/stack/settings', {
        enable_transport: true,
        share_instance: true,
        loglevel: 3,
        announce_interval_sec: 600,
      });
    });
  });

  it('shows offline reason on local serial interface rows', async () => {
    mockReticulumProxyGet({
      interfaces: [
        {
          id: 'heltec',
          name: 'Heltec V3',
          type: 'rnode',
          enabled: true,
          status: 'down',
          serial_port: '/dev/cu.usbserial-7',
        },
      ],
      serialPorts: [{ path: '/dev/cu.usbserial-0001' }],
    });

    render(<ReticulumRadioPanel connecting={false} onStartStack={async () => {}} />);

    await waitFor(() => {
      expect(
        screen.getByText('connectionPanel.reticulumInterfaces.localOfflineRowStale'),
      ).toBeInTheDocument();
    });
  });

  it('does not flag BLE RNode interface rows as stale USB serial ports', async () => {
    mockReticulumProxyGet({
      interfaces: [
        {
          id: 'rnode-ble',
          name: 'RNode BLE',
          type: 'rnode',
          enabled: true,
          status: 'down',
          serial_port: 'ble://AA:BB:CC:DD:EE:FF',
        },
      ],
      serialPorts: [{ path: '/dev/cu.usbserial-1' }],
    });

    render(<ReticulumRadioPanel connecting={false} onStartStack={async () => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/RNode BLE \(rnode\)/)).toBeInTheDocument();
    });
    expect(
      screen.queryByText('connectionPanel.reticulumInterfaces.localOfflineRowStale'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumInterfaces.localOfflineRowBle'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('connectionPanel.reticulumInterfaces.localOfflineRow'),
    ).not.toBeInTheDocument();
  });

  it('edit BLE RNode shows Bluetooth address instead of serial stale hint', async () => {
    const user = userEvent.setup();
    mockReticulumProxyGet({
      interfaces: [
        {
          id: 'rnode-ble',
          name: 'rnode-c74c3816',
          type: 'rnode',
          enabled: true,
          status: 'down',
          serial_port: 'ble://AA:BB:CC:DD:EE:FF',
        },
      ],
      serialPorts: [{ path: '/dev/cu.usbserial-1' }],
      bleAvailable: true,
    });

    render(<ReticulumRadioPanel connecting={false} onStartStack={async () => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/rnode-c74c3816 \(rnode\)/)).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumInterfaces.edit' }),
    );

    await waitFor(() => {
      expect(
        screen.getByLabelText('connectionPanel.reticulumInterfaces.rnodeTransportBle'),
      ).toHaveValue('ble://AA:BB:CC:DD:EE:FF');
    });
    expect(
      screen.queryByText('connectionPanel.reticulumLocalInterfaces.stalePortHint'),
    ).not.toBeInTheDocument();
  });

  it('opens serial device picker from add interface flow', async () => {
    const user = userEvent.setup();
    mockReticulumProxyGet({
      serialPorts: [{ path: '/dev/cu.usbserial-1', label: 'Radio USB' }],
    });

    render(<ReticulumRadioPanel connecting={false} onStartStack={async () => {}} />);

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyGet).toHaveBeenCalledWith('/api/v1/serial/ports');
    });

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

  it('does not show mesh BLE conflict banner when Reticulum BLE is enabled alongside mesh', async () => {
    mockReticulumProxyGet({
      bleAvailable: true,
      interfaces: [
        {
          id: 'peer1',
          name: 'BLE Peer',
          type: 'ble_peer',
          enabled: true,
          status: 'up',
        },
      ],
    });
    useIdentityStore.setState({
      identities: {
        mt: {
          id: 'mt',
          protocol: { type: 'meshtastic' } as never,
          signature: '1',
          transports: [],
          createdAt: 0,
          lastSeenAt: 0,
        },
      },
      activeIdentityId: 'mt',
    });
    setConnection('mt', {
      status: 'connected',
      connectionType: 'ble',
      mqttStatus: 'disconnected',
      reconnectAttempt: 0,
      myNodeNum: 1,
    });

    render(<ReticulumRadioPanel connecting={false} onStartStack={async () => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/BLE Peer \(ble_peer\)/)).toBeInTheDocument();
    });
    expect(
      screen.queryByText('connectionPanel.reticulumInterfaces.reticulumBleBlocksMesh'),
    ).not.toBeInTheDocument();
  });

  it('opens BLE RNode picker when transport is Bluetooth', async () => {
    const user = userEvent.setup();
    mockReticulumProxyGet({ bleAvailable: true });

    render(<ReticulumRadioPanel connecting={false} onStartStack={async () => {}} />);

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
});
