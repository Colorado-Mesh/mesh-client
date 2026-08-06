// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceState } from '@/renderer/lib/types';

const mocks = vi.hoisted(() => ({
  loadLastConnection: vi.fn(),
  loadLastBleDeviceId: vi.fn(),
  reconnectBleWithScan: vi.fn(),
  awaitReticulumBleCoexistenceClear: vi.fn(),
  dualNobleBleBothRadiosConfigured: vi.fn(),
  getNobleBleDualRadioPrimaryProtocol: vi.fn(),
  isNobleBleDualRadioSecondary: vi.fn(),
  isRendererNobleBlePlatform: vi.fn(),
  meshcoreTargetsSharedMeshtasticBlePeripheral: vi.fn(),
  notifyNobleBlePrimaryAutoConnectSettled: vi.fn(),
  tryGetMeshtasticSession: vi.fn(),
  tryGetMeshcoreSession: vi.fn(),
  awaitNobleBleProtocolSettle: vi.fn(),
}));

vi.mock('@/renderer/lib/lastConnectionStorage', () => ({
  loadLastConnection: mocks.loadLastConnection,
  loadLastBleDeviceId: mocks.loadLastBleDeviceId,
  saveLastConnection: vi.fn(),
}));

vi.mock('@/renderer/lib/bleReconnectHelper', () => ({
  reconnectBleWithScan: mocks.reconnectBleWithScan,
}));

vi.mock('@/renderer/lib/reticulum/reticulumStartupAutostartGate', () => ({
  awaitReticulumBleCoexistenceClear: mocks.awaitReticulumBleCoexistenceClear,
}));

vi.mock('@/renderer/lib/meshcoreDualNobleBleInit', () => ({
  awaitNobleBlePrimaryAutoConnectSettled: vi.fn().mockResolvedValue(undefined),
  awaitNobleBleProtocolSettle: mocks.awaitNobleBleProtocolSettle,
  dualNobleBleBothRadiosConfigured: mocks.dualNobleBleBothRadiosConfigured,
  getNobleBleDualRadioPrimaryProtocol: mocks.getNobleBleDualRadioPrimaryProtocol,
  isNobleBleDualRadioSecondary: mocks.isNobleBleDualRadioSecondary,
  isRendererNobleBlePlatform: mocks.isRendererNobleBlePlatform,
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
    mocks.reconnectBleWithScan.mockImplementation(async (_p, _id, attempt) => {
      await attempt();
    });
    mocks.awaitReticulumBleCoexistenceClear.mockResolvedValue(undefined);
    mocks.dualNobleBleBothRadiosConfigured.mockReturnValue(false);
    mocks.getNobleBleDualRadioPrimaryProtocol.mockReturnValue(null);
    mocks.isNobleBleDualRadioSecondary.mockReturnValue(false);
    mocks.isRendererNobleBlePlatform.mockReturnValue(true);
    mocks.meshcoreTargetsSharedMeshtasticBlePeripheral.mockReturnValue(false);
    mocks.tryGetMeshtasticSession.mockReturnValue({ connectAutomatic: vi.fn() });
    mocks.tryGetMeshcoreSession.mockReturnValue({ connectAutomatic: vi.fn() });
    mocks.awaitNobleBleProtocolSettle.mockResolvedValue(undefined);
    vi.spyOn(window.electronAPI, 'getPlatform').mockReturnValue('darwin');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips meshtastic when no remembered connection and does not wait on Reticulum gate', async () => {
    const connectAutomatic = vi.fn();

    renderHook(() => {
      useProtocolRfAutoConnect({
        protocol: 'meshtastic',
        state: disconnected,
        connectAutomatic,
      });
    });

    await waitFor(() => {
      expect(mocks.loadLastConnection).toHaveBeenCalledWith('meshtastic');
    });
    expect(connectAutomatic).not.toHaveBeenCalled();
    expect(mocks.awaitReticulumBleCoexistenceClear).not.toHaveBeenCalled();
  });

  it('skips meshcore when no remembered connection', async () => {
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
    expect(connectAutomatic).not.toHaveBeenCalled();
    expect(mocks.awaitReticulumBleCoexistenceClear).not.toHaveBeenCalled();
  });

  it('skips meshcore BLE when it shares the Meshtastic peripheral', async () => {
    mocks.loadLastConnection.mockImplementation((protocol: string) => {
      if (protocol === 'meshcore') {
        return { type: 'ble' as const, bleDeviceId: 'shared-peripheral' };
      }
      return null;
    });
    mocks.meshcoreTargetsSharedMeshtasticBlePeripheral.mockReturnValue(true);
    const connectAutomatic = vi.fn();

    renderHook(() => {
      useProtocolRfAutoConnect({
        protocol: 'meshcore',
        state: disconnected,
        connectAutomatic,
      });
    });

    await waitFor(() => {
      expect(mocks.meshcoreTargetsSharedMeshtasticBlePeripheral).toHaveBeenCalledWith(
        'shared-peripheral',
      );
    });
    expect(connectAutomatic).not.toHaveBeenCalled();
    expect(mocks.awaitReticulumBleCoexistenceClear).not.toHaveBeenCalled();
    expect(mocks.notifyNobleBlePrimaryAutoConnectSettled).not.toHaveBeenCalled();
  });

  it('does not defer secondary when only one Noble BLE radio is configured', async () => {
    mocks.loadLastConnection.mockReturnValue({ type: 'ble', bleDeviceId: 'meshtastic-only' });
    mocks.dualNobleBleBothRadiosConfigured.mockReturnValue(false);
    mocks.isNobleBleDualRadioSecondary.mockReturnValue(false);
    const connectAutomatic = vi.fn().mockResolvedValue(undefined);

    renderHook(() => {
      useProtocolRfAutoConnect({
        protocol: 'meshtastic',
        state: disconnected,
        connectAutomatic,
      });
    });

    await waitFor(() => {
      expect(mocks.awaitReticulumBleCoexistenceClear).toHaveBeenCalled();
    });
    expect(mocks.awaitNobleBleProtocolSettle).not.toHaveBeenCalled();
    expect(connectAutomatic).toHaveBeenCalledWith('ble', undefined, undefined, 'meshtastic-only');
  });

  it('waits on Reticulum gate only when attempting Noble BLE connect', async () => {
    mocks.loadLastConnection.mockReturnValue({ type: 'ble', bleDeviceId: 'radio-ble' });
    const connectAutomatic = vi.fn().mockResolvedValue(undefined);

    renderHook(() => {
      useProtocolRfAutoConnect({
        protocol: 'meshtastic',
        state: disconnected,
        connectAutomatic,
      });
    });

    await waitFor(() => {
      expect(connectAutomatic).toHaveBeenCalled();
    });
    expect(mocks.awaitReticulumBleCoexistenceClear).toHaveBeenCalledTimes(1);
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
    mocks.awaitReticulumBleCoexistenceClear.mockResolvedValue(undefined);
    mocks.dualNobleBleBothRadiosConfigured.mockReturnValue(false);
    mocks.getNobleBleDualRadioPrimaryProtocol.mockReturnValue(null);
    mocks.isNobleBleDualRadioSecondary.mockReturnValue(false);
    mocks.isRendererNobleBlePlatform.mockReturnValue(true);
    mocks.meshcoreTargetsSharedMeshtasticBlePeripheral.mockReturnValue(false);
    mocks.tryGetMeshtasticSession.mockReturnValue({ connectAutomatic: vi.fn() });
    mocks.tryGetMeshcoreSession.mockReturnValue({ connectAutomatic: vi.fn() });
    mocks.awaitNobleBleProtocolSettle.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['linux', 'darwin', 'win32'] as const)(
    'auto-connects meshtastic TCP with stored address and skips Reticulum gate (%s)',
    async (platform) => {
      vi.spyOn(window.electronAPI, 'getPlatform').mockReturnValue(platform);
      mocks.loadLastConnection.mockReturnValue({
        type: 'tcp',
        httpAddress: '192.168.1.50:4403',
      });
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
      expect(mocks.awaitReticulumBleCoexistenceClear).not.toHaveBeenCalled();
    },
  );

  it.each(['linux', 'darwin', 'win32'] as const)(
    'auto-connects meshcore HTTP (TCP/IP) with stored address and skips Reticulum gate (%s)',
    async (platform) => {
      vi.spyOn(window.electronAPI, 'getPlatform').mockReturnValue(platform);
      mocks.loadLastConnection.mockReturnValue({
        type: 'http',
        httpAddress: '10.0.0.1:5000',
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
        expect(connectAutomatic).toHaveBeenCalledWith('http', '10.0.0.1:5000');
      });
      expect(mocks.awaitReticulumBleCoexistenceClear).not.toHaveBeenCalled();
    },
  );

  it.each(['linux', 'darwin', 'win32'] as const)(
    'skips TCP auto-connect when httpAddress is blank and settles primary gate if needed (%s)',
    async (platform) => {
      vi.spyOn(window.electronAPI, 'getPlatform').mockReturnValue(platform);
      mocks.loadLastConnection.mockReturnValue({ type: 'tcp', httpAddress: '   ' });
      mocks.dualNobleBleBothRadiosConfigured.mockReturnValue(true);
      mocks.getNobleBleDualRadioPrimaryProtocol.mockReturnValue('meshtastic');
      const connectAutomatic = vi.fn();

      renderHook(() => {
        useProtocolRfAutoConnect({
          protocol: 'meshtastic',
          state: disconnected,
          connectAutomatic,
        });
      });

      await waitFor(() => {
        expect(mocks.notifyNobleBlePrimaryAutoConnectSettled).toHaveBeenCalled();
      });
      expect(connectAutomatic).not.toHaveBeenCalled();
      expect(mocks.awaitReticulumBleCoexistenceClear).not.toHaveBeenCalled();
    },
  );

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
