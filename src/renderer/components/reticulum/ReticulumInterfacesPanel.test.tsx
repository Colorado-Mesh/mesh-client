import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ReticulumInterfaceRow,
  ReticulumSerialPortOption,
} from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';
import { useConnectionStore } from '@/renderer/stores/connectionStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

    expect(screen.getByText(/RNode BLE \(rnode\)/)).toBeInTheDocument();
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
});
