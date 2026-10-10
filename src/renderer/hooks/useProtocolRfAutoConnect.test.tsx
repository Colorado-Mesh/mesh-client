// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceState } from '@/renderer/lib/types';

const mocks = vi.hoisted(() => ({
  loadLastConnection: vi.fn(),
  loadLastBleDeviceId: vi.fn(),
  saveLastConnection: vi.fn(),
  clearStoredBleSelection: vi.fn(),
  notifyBleSelectionCleared: vi.fn(),
  reconnectBleWithScan: vi.fn(),
  awaitReticulumBleCoexistenceClear: vi.fn(),
  dualNobleBleBothRadiosConfigured: vi.fn(),
  getNobleBleDualRadioPrimaryProtocol: vi.fn(),
  isNobleBleDualRadioSecondary: vi.fn(),
  isRendererGattBlePlatform: vi.fn(),
  meshcoreTargetsSharedMeshtasticBlePeripheral: vi.fn(),
  notifyNobleBlePrimaryAutoConnectSettled: vi.fn(),
  awaitNobleBlePrimaryAutoConnectSettled: vi.fn(),
  tryGetMeshtasticSession: vi.fn(),
  tryGetMeshcoreSession: vi.fn(),
  awaitNobleBleProtocolSettle: vi.fn(),
}));

vi.mock('@/renderer/lib/lastConnectionStorage', () => ({
  clearStoredBleSelection: mocks.clearStoredBleSelection,
  notifyBleSelectionCleared: mocks.notifyBleSelectionCleared,
  loadLastConnection: mocks.loadLastConnection,
  loadLastBleDeviceId: mocks.loadLastBleDeviceId,
  saveLastConnection: mocks.saveLastConnection,
}));

vi.mock('@/renderer/lib/bleReconnectHelper', () => ({
  reconnectBleWithScan: mocks.reconnectBleWithScan,
}));

vi.mock('@/renderer/lib/reticulum/reticulumStartupAutostartGate', () => ({
  awaitReticulumBleCoexistenceClear: mocks.awaitReticulumBleCoexistenceClear,
}));

vi.mock('@/renderer/lib/meshcoreDualNobleBleInit', () => ({
  awaitNobleBlePrimaryAutoConnectSettled: mocks.awaitNobleBlePrimaryAutoConnectSettled,
  awaitNobleBleProtocolSettle: mocks.awaitNobleBleProtocolSettle,
  dualNobleBleBothRadiosConfigured: mocks.dualNobleBleBothRadiosConfigured,
  getNobleBleDualRadioPrimaryProtocol: mocks.getNobleBleDualRadioPrimaryProtocol,
  isNobleBleDualRadioSecondary: mocks.isNobleBleDualRadioSecondary,
  isRendererGattBlePlatform: mocks.isRendererGattBlePlatform,
  meshcoreTargetsSharedMeshtasticBlePeripheral: mocks.meshcoreTargetsSharedMeshtasticBlePeripheral,
  notifyNobleBlePrimaryAutoConnectSettled: mocks.notifyNobleBlePrimaryAutoConnectSettled,
}));

vi.mock('@/renderer/lib/sessions/meshtasticSession', () => ({
  tryGetMeshtasticSession: mocks.tryGetMeshtasticSession,
}));

vi.mock('@/renderer/lib/sessions/meshcoreSession', () => ({
  tryGetMeshcoreSession: mocks.tryGetMeshcoreSession,
}));

import { useProtocolRfAutoConnect } from './useProtocolRfAutoConnect';

const disconnected: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  connectionType: null,
};

describe('useProtocolRfAutoConnect cold-start skip paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadLastConnection.mockReturnValue(null);
    mocks.loadLastBleDeviceId.mockReturnValue(null);
    mocks.clearStoredBleSelection.mockReset();
    mocks.notifyBleSelectionCleared.mockReset();
    mocks.reconnectBleWithScan.mockImplementation(async (_p, _id, attempt) => {
      await attempt();
    });
    mocks.awaitReticulumBleCoexistenceClear.mockResolvedValue(undefined);
    mocks.dualNobleBleBothRadiosConfigured.mockReturnValue(false);
    mocks.getNobleBleDualRadioPrimaryProtocol.mockReturnValue(null);
    mocks.isNobleBleDualRadioSecondary.mockReturnValue(false);
    mocks.isRendererGattBlePlatform.mockReturnValue(true);
    mocks.meshcoreTargetsSharedMeshtasticBlePeripheral.mockReturnValue(false);
    mocks.tryGetMeshtasticSession.mockReturnValue({ connectAutomatic: vi.fn() });
    mocks.tryGetMeshcoreSession.mockReturnValue({ connectAutomatic: vi.fn() });
    mocks.awaitNobleBleProtocolSettle.mockResolvedValue(undefined);
    mocks.awaitNobleBlePrimaryAutoConnectSettled.mockResolvedValue(undefined);
    vi.spyOn(window.electronAPI, 'getPlatform').mockReturnValue('darwin');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never connects a disabled protocol and releases a waiting dual-radio secondary', async () => {
    mocks.loadLastConnection.mockReturnValue({ type: 'ble', bleDeviceId: 'radio-ble' });
    mocks.dualNobleBleBothRadiosConfigured.mockReturnValue(true);
    mocks.getNobleBleDualRadioPrimaryProtocol.mockReturnValue('meshtastic');
    const connectAutomatic = vi.fn().mockResolvedValue(undefined);

    renderHook(() => {
      useProtocolRfAutoConnect({
        protocol: 'meshtastic',
        state: disconnected,
        connectAutomatic,
        enabled: false,
      });
    });

    await waitFor(() => {
      expect(mocks.notifyNobleBlePrimaryAutoConnectSettled).toHaveBeenCalled();
    });
    expect(mocks.loadLastConnection).not.toHaveBeenCalled();
    expect(connectAutomatic).not.toHaveBeenCalled();
  });

  it('aborts deferred MeshCore BLE auto-connect when manual connect cancels the gate', async () => {
    const { cancelProtocolRfAutoConnect } =
      await import('@/renderer/lib/protocolRfAutoConnectGate');
    mocks.loadLastConnection.mockReturnValue({ type: 'ble', bleDeviceId: 'meshcore-ble' });
    mocks.dualNobleBleBothRadiosConfigured.mockReturnValue(true);
    mocks.isNobleBleDualRadioSecondary.mockReturnValue(true);
    mocks.getNobleBleDualRadioPrimaryProtocol.mockReturnValue('meshtastic');
    mocks.awaitNobleBleProtocolSettle.mockImplementation(() => {
      cancelProtocolRfAutoConnect('meshcore');
      return Promise.resolve();
    });
    const connectAutomatic = vi.fn().mockResolvedValue(undefined);

    renderHook(() => {
      useProtocolRfAutoConnect({
        protocol: 'meshcore',
        state: disconnected,
        connectAutomatic,
      });
    });

    await waitFor(() => {
      expect(mocks.awaitNobleBleProtocolSettle).toHaveBeenCalled();
    });
    expect(connectAutomatic).not.toHaveBeenCalled();
  });
});

describe('useProtocolRfAutoConnect cold-start TCP/HTTP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadLastConnection.mockReturnValue(null);
    mocks.loadLastBleDeviceId.mockReturnValue(null);
    mocks.clearStoredBleSelection.mockReset();
    mocks.notifyBleSelectionCleared.mockReset();
    mocks.awaitReticulumBleCoexistenceClear.mockResolvedValue(undefined);
    mocks.dualNobleBleBothRadiosConfigured.mockReturnValue(false);
    mocks.getNobleBleDualRadioPrimaryProtocol.mockReturnValue(null);
    mocks.isNobleBleDualRadioSecondary.mockReturnValue(false);
    mocks.isRendererGattBlePlatform.mockReturnValue(true);
    mocks.meshcoreTargetsSharedMeshtasticBlePeripheral.mockReturnValue(false);
    mocks.tryGetMeshtasticSession.mockReturnValue({ connectAutomatic: vi.fn() });
    mocks.tryGetMeshcoreSession.mockReturnValue({ connectAutomatic: vi.fn() });
    mocks.awaitNobleBleProtocolSettle.mockResolvedValue(undefined);
    mocks.awaitNobleBlePrimaryAutoConnectSettled.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('settles dual-radio primary gate after TCP auto-connect succeeds', async () => {
    mocks.loadLastConnection.mockReturnValue({
      type: 'tcp',
      httpAddress: '192.168.1.50:4403',
    });
    mocks.dualNobleBleBothRadiosConfigured.mockReturnValue(true);
    mocks.getNobleBleDualRadioPrimaryProtocol.mockReturnValue('meshtastic');
    const connectAutomatic = vi.fn().mockResolvedValue(undefined);

    renderHook(() => {
      useProtocolRfAutoConnect({
        protocol: 'meshtastic',
        state: disconnected,
        connectAutomatic,
      });
    });

    await waitFor(() => {
      expect(connectAutomatic).toHaveBeenCalledWith('tcp', '192.168.1.50:4403');
    });
    await waitFor(() => {
      expect(mocks.notifyNobleBlePrimaryAutoConnectSettled).toHaveBeenCalled();
    });
  });

  it('settles dual-radio primary gate after HTTP auto-connect succeeds', async () => {
    mocks.loadLastConnection.mockReturnValue({
      type: 'http',
      httpAddress: '10.0.0.1:5000',
    });
    mocks.dualNobleBleBothRadiosConfigured.mockReturnValue(true);
    mocks.getNobleBleDualRadioPrimaryProtocol.mockReturnValue('meshcore');
    const connectAutomatic = vi.fn().mockResolvedValue(undefined);

    renderHook(() => {
      useProtocolRfAutoConnect({
        protocol: 'meshcore',
        state: disconnected,
        connectAutomatic,
      });
    });

    await waitFor(() => {
      expect(connectAutomatic).toHaveBeenCalledWith('http', '10.0.0.1:5000');
    });
    await waitFor(() => {
      expect(mocks.notifyNobleBlePrimaryAutoConnectSettled).toHaveBeenCalled();
    });
  });

  it.each(['linux', 'darwin', 'win32'] as const)(
    'skips HTTP auto-connect when httpAddress is missing (%s)',
    async (platform) => {
      vi.spyOn(window.electronAPI, 'getPlatform').mockReturnValue(platform);
      mocks.loadLastConnection.mockReturnValue({ type: 'http' });
      const connectAutomatic = vi.fn();

      renderHook(() => {
        useProtocolRfAutoConnect({
          protocol: 'meshcore',
          state: disconnected,
          connectAutomatic,
        });
      });

      await waitFor(() => {
        expect(mocks.loadLastConnection).toHaveBeenCalledWith('meshcore');
      });
      // Session wait is async — give the startup path a tick to finish without connecting.
      await waitFor(() => {
        expect(mocks.tryGetMeshcoreSession).toHaveBeenCalled();
      });
      expect(connectAutomatic).not.toHaveBeenCalled();
    },
  );
});

describe('useProtocolRfAutoConnect cold-start serial + BLE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadLastConnection.mockReturnValue(null);
    mocks.loadLastBleDeviceId.mockReturnValue(null);
    mocks.clearStoredBleSelection.mockReset();
    mocks.notifyBleSelectionCleared.mockReset();
    mocks.reconnectBleWithScan.mockImplementation(async (_p, _id, attempt) => {
      await attempt();
    });
    mocks.awaitReticulumBleCoexistenceClear.mockResolvedValue(undefined);
    mocks.dualNobleBleBothRadiosConfigured.mockReturnValue(false);
    mocks.getNobleBleDualRadioPrimaryProtocol.mockReturnValue(null);
    mocks.isNobleBleDualRadioSecondary.mockReturnValue(false);
    mocks.isRendererGattBlePlatform.mockReturnValue(true);
    mocks.meshcoreTargetsSharedMeshtasticBlePeripheral.mockReturnValue(false);
    mocks.tryGetMeshtasticSession.mockReturnValue({ connectAutomatic: vi.fn() });
    mocks.tryGetMeshcoreSession.mockReturnValue({ connectAutomatic: vi.fn() });
    mocks.awaitNobleBleProtocolSettle.mockResolvedValue(undefined);
    mocks.awaitNobleBlePrimaryAutoConnectSettled.mockResolvedValue(undefined);
    vi.spyOn(window.electronAPI, 'getPlatform').mockReturnValue('darwin');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('settles dual-radio primary gate after serial auto-connect succeeds', async () => {
    mocks.loadLastConnection.mockReturnValue({ type: 'serial', serialPortId: 'port-1' });
    mocks.dualNobleBleBothRadiosConfigured.mockReturnValue(true);
    mocks.getNobleBleDualRadioPrimaryProtocol.mockReturnValue('meshtastic');
    const connectAutomatic = vi.fn().mockResolvedValue(undefined);

    renderHook(() => {
      useProtocolRfAutoConnect({
        protocol: 'meshtastic',
        state: disconnected,
        connectAutomatic,
      });
    });

    await waitFor(() => {
      expect(connectAutomatic).toHaveBeenCalledWith('serial', undefined, 'port-1');
    });
    await waitFor(() => {
      expect(mocks.notifyNobleBlePrimaryAutoConnectSettled).toHaveBeenCalled();
    });
  });

  it.each(['darwin', 'win32'] as const)(
    'settles dual-radio primary gate after Noble BLE auto-connect succeeds (%s)',
    async (platform) => {
      vi.spyOn(window.electronAPI, 'getPlatform').mockReturnValue(platform);
      mocks.loadLastConnection.mockReturnValue({ type: 'ble', bleDeviceId: 'primary-ble' });
      mocks.dualNobleBleBothRadiosConfigured.mockReturnValue(true);
      mocks.getNobleBleDualRadioPrimaryProtocol.mockReturnValue('meshtastic');
      const connectAutomatic = vi.fn().mockResolvedValue(undefined);

      renderHook(() => {
        useProtocolRfAutoConnect({
          protocol: 'meshtastic',
          state: disconnected,
          connectAutomatic,
        });
      });

      await waitFor(() => {
        expect(connectAutomatic).toHaveBeenCalledWith('ble', undefined, undefined, 'primary-ble');
      });
      await waitFor(() => {
        expect(mocks.notifyNobleBlePrimaryAutoConnectSettled).toHaveBeenCalled();
      });
    },
  );

  it.each(['darwin', 'win32'] as const)(
    'secondary waits for primary settle then protocol settle before BLE connect (%s)',
    async (platform) => {
      vi.spyOn(window.electronAPI, 'getPlatform').mockReturnValue(platform);
      mocks.loadLastConnection.mockReturnValue({ type: 'ble', bleDeviceId: 'secondary-ble' });
      mocks.dualNobleBleBothRadiosConfigured.mockReturnValue(true);
      mocks.isNobleBleDualRadioSecondary.mockReturnValue(true);
      mocks.getNobleBleDualRadioPrimaryProtocol.mockReturnValue('meshtastic');
      const connectAutomatic = vi.fn().mockResolvedValue(undefined);

      renderHook(() => {
        useProtocolRfAutoConnect({
          protocol: 'meshcore',
          state: disconnected,
          connectAutomatic,
        });
      });

      await waitFor(() => {
        expect(connectAutomatic).toHaveBeenCalledWith('ble', undefined, undefined, 'secondary-ble');
      });
      expect(mocks.awaitNobleBlePrimaryAutoConnectSettled).toHaveBeenCalled();
      expect(mocks.awaitNobleBleProtocolSettle).toHaveBeenCalledWith(
        'meshtastic',
        expect.any(Number),
      );

      // Order matters: primary settle → protocol settle → BLE connect. Assert the actual call
      // sequence, not merely that each was invoked.
      const primaryOrder = mocks.awaitNobleBlePrimaryAutoConnectSettled.mock.invocationCallOrder[0];
      const protocolOrder = mocks.awaitNobleBleProtocolSettle.mock.invocationCallOrder[0];
      const connectOrder = connectAutomatic.mock.invocationCallOrder[0];
      expect(primaryOrder).toBeLessThan(protocolOrder);
      expect(protocolOrder).toBeLessThan(connectOrder);
    },
  );

  it('clears remembered MeshCore BLE selection after missing-services auto-connect failure', async () => {
    vi.spyOn(window.electronAPI, 'getPlatform').mockReturnValue('darwin');
    mocks.loadLastConnection.mockReturnValue({ type: 'ble', bleDeviceId: 'meshcore-ble' });
    const connectAutomatic = vi
      .fn()
      .mockRejectedValue(new Error('Failed to find required BLE characteristics'));

    renderHook(() => {
      useProtocolRfAutoConnect({
        protocol: 'meshcore',
        state: disconnected,
        connectAutomatic,
      });
    });

    await waitFor(() => {
      expect(connectAutomatic).toHaveBeenCalledWith('ble', undefined, undefined, 'meshcore-ble');
    });
    await waitFor(() => {
      expect(mocks.clearStoredBleSelection).toHaveBeenCalledWith('meshcore');
    });
    expect(mocks.notifyBleSelectionCleared).toHaveBeenCalledWith('meshcore');
  });
});
