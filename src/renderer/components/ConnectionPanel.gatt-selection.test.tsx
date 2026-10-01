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
    vi.mocked(window.electronAPI.gattPairState)
      .mockReset()
      .mockResolvedValue({ ok: false, code: 'unsupported', error: 'mock' });
    vi.mocked(window.electronAPI.gattPair).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.gattUnpair).mockReset().mockResolvedValue({ ok: true });
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

  it.each([
    ['linux', false],
    ['darwin', false],
    ['win32', true],
  ] as const)(
    'shows the MeshCore pairing hint on %s (Windows expectations: %s)',
    async (platform, showsWindowsHint) => {
      const user = userEvent.setup();
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
      render(
        <ConnectionPanel
          state={disconnectedState}
          protocol="meshcore"
          mqttStatus="disconnected"
          onConnect={vi.fn().mockResolvedValue(undefined)}
          onAutoConnect={vi.fn().mockResolvedValue(undefined)}
          onDisconnect={vi.fn().mockResolvedValue(undefined)}
        />,
      );
      const radio = screen.getByText('Radio Connection').closest<HTMLElement>('.bg-deep-black')!;
      await user.click(within(radio).getByRole('button', { name: 'Connect' }));
      act(() => discovered?.(device));
      expect(await screen.findByText(/Pair your MeshCore device/)).toBeInTheDocument();
      expect(screen.queryByText(/do not need to pair it in Windows Settings/) !== null).toBe(
        showsWindowsHint,
      );
    },
  );

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

  describe('Windows in-app pairing', () => {
    const renderPanel = (protocol: 'meshtastic' | 'meshcore', onConnect = vi.fn()) => {
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
      return onConnect;
    };
    const selectRadio = async (user: ReturnType<typeof userEvent.setup>) => {
      const radio = screen.getByText('Radio Connection').closest<HTMLElement>('.bg-deep-black')!;
      await user.click(within(radio).getByRole('button', { name: 'Connect' }));
      act(() => discovered?.(device));
      await user.click(await screen.findByRole('button', { name: /Test Radio aa:bb:cc:dd:ee:ff/ }));
    };

    beforeEach(() => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue('win32');
    });

    it('connects straight away when Windows already holds a bond', async () => {
      const user = userEvent.setup();
      vi.mocked(window.electronAPI.gattPairState).mockResolvedValue({ ok: true, paired: true });
      const onConnect = renderPanel('meshcore', vi.fn().mockResolvedValue(undefined));
      await selectRadio(user);
      await waitFor(() => {
        expect(onConnect).toHaveBeenCalledExactlyOnceWith('ble', undefined, device.deviceId);
      });
      expect(window.electronAPI.gattPairState).toHaveBeenCalledWith(device.deviceId);
      expect(window.electronAPI.gattPair).not.toHaveBeenCalled();
      expect(screen.queryByPlaceholderText('PIN')).not.toBeInTheDocument();
    });

    it.each([
      ['meshcore', ''],
      ['meshtastic', '123456'],
    ] as const)(
      'pairs an unpaired %s radio in-app before opening GATT',
      async (protocol, prefill) => {
        const user = userEvent.setup();
        vi.mocked(window.electronAPI.gattPairState).mockResolvedValue({ ok: true, paired: false });
        const onConnect = renderPanel(protocol, vi.fn().mockResolvedValue(undefined));
        await selectRadio(user);
        const pin = await screen.findByPlaceholderText('PIN');
        expect(pin).toHaveValue(prefill);
        expect(onConnect).not.toHaveBeenCalled();
        await user.clear(pin);
        await user.type(pin, '654321');
        await user.click(screen.getByRole('button', { name: 'Submit' }));
        await waitFor(() => {
          expect(window.electronAPI.gattPair).toHaveBeenCalledWith(device.deviceId, '654321');
          expect(onConnect).toHaveBeenCalledExactlyOnceWith('ble', undefined, device.deviceId);
        });
        expect(window.electronAPI.gattUnpair).not.toHaveBeenCalled();
        expect(window.electronAPI.bluetoothPair).not.toHaveBeenCalled();
      },
    );

    it('keeps the PIN prompt open when Windows rejects the PIN', async () => {
      const user = userEvent.setup();
      vi.mocked(window.electronAPI.gattPairState).mockResolvedValue({ ok: true, paired: false });
      vi.mocked(window.electronAPI.gattPair)
        .mockResolvedValueOnce({
          ok: false,
          code: 'authentication_failed',
          error: 'Windows rejected the pairing PIN (status=AuthenticationFailure)',
        })
        .mockResolvedValueOnce({ ok: true });
      const onConnect = renderPanel('meshcore', vi.fn().mockResolvedValue(undefined));
      await selectRadio(user);
      await user.type(await screen.findByPlaceholderText('PIN'), '000000');
      await user.click(screen.getByRole('button', { name: 'Submit' }));
      expect(await screen.findByText(/Windows rejected that PIN/)).toBeInTheDocument();
      expect(onConnect).not.toHaveBeenCalled();
      const pin = screen.getByPlaceholderText('PIN');
      await user.clear(pin);
      await user.type(pin, '123456');
      await user.click(screen.getByRole('button', { name: 'Submit' }));
      await waitFor(() => {
        expect(onConnect).toHaveBeenCalledExactlyOnceWith('ble', undefined, device.deviceId);
      });
    });

    it('offers Remove & Re-pair after a pairing_required connect failure', async () => {
      const user = userEvent.setup();
      vi.mocked(window.electronAPI.gattPairState).mockResolvedValue({ ok: true, paired: true });
      const onConnect = renderPanel(
        'meshcore',
        vi
          .fn()
          .mockRejectedValueOnce(new Error('pairing_required: subscribe: Access is denied.'))
          .mockResolvedValue(undefined),
      );
      await selectRadio(user);
      await user.click(await screen.findByRole('button', { name: 'Remove & Re-pair Device' }));
      await user.type(await screen.findByPlaceholderText('PIN'), '112233');
      await user.click(screen.getByRole('button', { name: 'Submit' }));
      await waitFor(() => {
        expect(window.electronAPI.gattUnpair).toHaveBeenCalledWith(device.deviceId);
        expect(window.electronAPI.gattPair).toHaveBeenCalledWith(device.deviceId, '112233');
        expect(onConnect).toHaveBeenCalledTimes(2);
      });
      expect(vi.mocked(window.electronAPI.gattUnpair).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(window.electronAPI.gattPair).mock.invocationCallOrder[0],
      );
    });

    it('offers Remove & Re-pair when the Bluetooth stack is wedged', async () => {
      const user = userEvent.setup();
      vi.mocked(window.electronAPI.gattPairState).mockResolvedValue({ ok: true, paired: true });
      renderPanel(
        'meshcore',
        vi
          .fn()
          .mockRejectedValue(
            new Error('connect_timeout: connect timed out: Bluetooth stack unresponsive'),
          ),
      );
      await selectRadio(user);
      expect(
        await screen.findByRole('button', { name: 'Remove & Re-pair Device' }),
      ).toBeInTheDocument();
    });

    it('Reconnect prompts for a PIN instead of a doomed connect when the bond is gone', async () => {
      const user = userEvent.setup();
      localStorage.setItem(
        'mesh-client:lastConnection:meshcore',
        JSON.stringify({ type: 'ble', bleDeviceId: device.deviceId }),
      );
      vi.mocked(window.electronAPI.gattPairState).mockResolvedValue({ ok: true, paired: false });
      const onConnect = renderPanel('meshcore', vi.fn().mockResolvedValue(undefined));
      await user.click(await screen.findByRole('button', { name: /^Reconnect$/i }));
      await user.type(await screen.findByPlaceholderText('PIN'), '445566');
      expect(onConnect).not.toHaveBeenCalled();
      expect(window.electronAPI.startGattScanning).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Submit' }));
      await waitFor(() => {
        expect(window.electronAPI.gattPair).toHaveBeenCalledWith(device.deviceId, '445566');
        expect(onConnect).toHaveBeenCalledExactlyOnceWith('ble', undefined, device.deviceId);
      });
    });

    it.each(['linux', 'darwin'] as const)(
      'never queries Windows pairing on %s',
      async (platform) => {
        const user = userEvent.setup();
        vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
        const onConnect = renderPanel('meshcore', vi.fn().mockResolvedValue(undefined));
        await selectRadio(user);
        await waitFor(() => {
          expect(onConnect).toHaveBeenCalledOnce();
        });
        expect(window.electronAPI.gattPairState).not.toHaveBeenCalled();
        expect(window.electronAPI.gattPair).not.toHaveBeenCalled();
      },
    );
  });

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
