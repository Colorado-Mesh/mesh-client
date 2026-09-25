import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GattBleDevice } from '@/shared/electron-api.types';

import type { DeviceState } from '../lib/types';
import ConnectionPanel from './ConnectionPanel';

const disconnectedState: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  reconnectAttempt: 0,
  connectionType: null,
};
const device: GattBleDevice = {
  deviceId: 'aa:bb:cc:dd:ee:ff',
  deviceName: 'Test Radio',
  address: 'aa:bb:cc:dd:ee:ff',
};

describe('ConnectionPanel manual GATT selection', () => {
  let discovered: ((device: GattBleDevice) => void) | undefined;

  beforeEach(() => {
    localStorage.clear();
    discovered = undefined;
    vi.mocked(window.electronAPI.onGattDeviceDiscovered).mockImplementation((cb) => {
      discovered = cb;
      return () => {};
    });
    vi.mocked(window.electronAPI.startGattScanning).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.stopGattScanning).mockClear();
    vi.mocked(window.electronAPI.bluetoothGetInfo).mockResolvedValue('Paired: yes');
    vi.mocked(window.electronAPI.bluetoothPair).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
  });

  it.each([
    ['linux', 'meshtastic'],
    ['darwin', 'meshtastic'],
    ['win32', 'meshtastic'],
    ['linux', 'meshcore'],
    ['darwin', 'meshcore'],
    ['win32', 'meshcore'],
  ] as const)('scans and connects the selected %s %s device', async (platform, protocol) => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
    const onConnect = vi.fn().mockResolvedValue(undefined);
    render(
      <ConnectionPanel
        state={disconnectedState}
        protocol={protocol}
        mqttStatus="disconnected"
        onConnect={onConnect}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const radio = screen.getByText('Radio Connection').closest<HTMLElement>('.bg-deep-black')!;
    await user.click(within(radio).getByRole('button', { name: 'Connect' }));
    expect(window.electronAPI.startGattScanning).toHaveBeenCalledWith(protocol);
    expect(onConnect).not.toHaveBeenCalled();
    act(() => discovered?.(device));
    await user.click(await screen.findByRole('button', { name: /Test Radio aa:bb:cc:dd:ee:ff/ }));
    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledExactlyOnceWith('ble', undefined, device.deviceId);
    });
  });

  it.each(['linux', 'darwin', 'win32'] as const)(
    'ignores scan results arriving after Cancel on %s',
    async (platform) => {
      const user = userEvent.setup();
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
      const onConnect = vi.fn().mockResolvedValue(undefined);
      const onDisconnect = vi.fn().mockResolvedValue(undefined);
      render(
        <ConnectionPanel
          state={disconnectedState}
          protocol="meshtastic"
          mqttStatus="disconnected"
          onConnect={onConnect}
          onAutoConnect={vi.fn().mockResolvedValue(undefined)}
          onDisconnect={onDisconnect}
        />,
      );
      const radio = screen.getByText('Radio Connection').closest<HTMLElement>('.bg-deep-black')!;
      await user.click(within(radio).getByRole('button', { name: 'Connect' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      act(() => discovered?.(device));
      expect(window.electronAPI.stopGattScanning).toHaveBeenCalledWith('meshtastic');
      expect(onDisconnect).toHaveBeenCalledOnce();
      expect(onConnect).not.toHaveBeenCalled();
      expect(screen.queryByText('Select Bluetooth Device')).not.toBeInTheDocument();
    },
  );

  it.each(['meshtastic', 'meshcore'] as const)(
    'pairs an unpaired Linux %s radio before opening GATT',
    async (protocol) => {
      const user = userEvent.setup();
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
      vi.mocked(window.electronAPI.bluetoothGetInfo).mockResolvedValue('Paired: no');
      const onConnect = vi.fn().mockResolvedValue(undefined);
      render(
        <ConnectionPanel
          state={disconnectedState}
          protocol={protocol}
          mqttStatus="disconnected"
          onConnect={onConnect}
          onAutoConnect={vi.fn().mockResolvedValue(undefined)}
          onDisconnect={vi.fn().mockResolvedValue(undefined)}
        />,
      );
      const radio = screen.getByText('Radio Connection').closest<HTMLElement>('.bg-deep-black')!;
      await user.click(within(radio).getByRole('button', { name: 'Connect' }));
      act(() => discovered?.(device));
      await user.click(await screen.findByRole('button', { name: /Test Radio aa:bb:cc:dd:ee:ff/ }));
      const pin = await screen.findByPlaceholderText('PIN');
      await user.clear(pin);
      await user.type(pin, '3456');
      expect(onConnect).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Submit' }));
      await waitFor(() => {
        expect(window.electronAPI.bluetoothPair).toHaveBeenCalledWith(device.deviceId, '3456');
        expect(onConnect).toHaveBeenCalledExactlyOnceWith('ble', undefined, device.deviceId);
      });
    },
  );

  it('does not resume cancelled Linux pairing when the same radio is selected again', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    vi.mocked(window.electronAPI.bluetoothGetInfo).mockResolvedValue('Paired: no');
    let finishPair!: () => void;
    vi.mocked(window.electronAPI.bluetoothPair).mockReturnValue(
      new Promise<void>((resolve) => {
        finishPair = resolve;
      }),
    );
    const onConnect = vi.fn().mockResolvedValue(undefined);
    render(
      <ConnectionPanel
        state={disconnectedState}
        protocol="meshcore"
        mqttStatus="disconnected"
        onConnect={onConnect}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const radio = screen.getByText('Radio Connection').closest<HTMLElement>('.bg-deep-black')!;
    await user.click(within(radio).getByRole('button', { name: 'Connect' }));
    act(() => discovered?.(device));
    await user.click(await screen.findByRole('button', { name: /Test Radio aa:bb:cc:dd:ee:ff/ }));
    await user.type(await screen.findByPlaceholderText('PIN'), '3456');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
    const reopenedRadio = screen
      .getByText('Radio Connection')
      .closest<HTMLElement>('.bg-deep-black')!;
    await user.click(within(reopenedRadio).getByRole('button', { name: 'Connect' }));
    act(() => discovered?.(device));
    await user.click(await screen.findByRole('button', { name: /Test Radio aa:bb:cc:dd:ee:ff/ }));
    expect(await screen.findByPlaceholderText('PIN')).toHaveValue('');
    await act(async () => {
      finishPair();
      await Promise.resolve();
    });
    expect(onConnect).not.toHaveBeenCalled();
  });
});
