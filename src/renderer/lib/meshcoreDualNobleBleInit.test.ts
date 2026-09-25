import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Protocol-neutral Noble BLE dual-radio coordinator (Meshtastic + MeshCore).
 * Meshtastic-specific defer/auto-connect behavior is covered in ConnectionPanel.test.tsx
 * (`ConnectionPanel active-protocol-first BLE auto-connect`).
 */
import { useConnectionStore } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import {
  awaitDualNobleBleMeshtasticSettle,
  awaitNobleBlePrimaryAutoConnectSettled,
  awaitNobleBleProtocolSettle,
  dualNobleBleBothRadiosConfigured,
  getNobleBleConnectMutexSnapshot,
  getNobleBleDualRadioPrimaryProtocol,
  initNobleBleDualRadioStartup,
  isRendererGattBlePlatform,
  meshcoreNobleBleConfigureBusy,
  meshcoreTargetsSharedMeshtasticBlePeripheral,
  meshtasticNobleBleConfigureBusy,
  needsSequentialMeshcoreRadioInit,
  nobleBleConfigureBusyForProtocol,
  notifyBlePrimaryRfLinkReady,
  notifyNobleBlePrimaryAutoConnectSettled,
  resetNobleBleConnectMutexForTests,
  resolveNobleBleDualRadioPrimaryProtocol,
} from './meshcoreDualNobleBleInit';

const meshtasticProtocol = { type: 'meshtastic' } as const;
const meshcoreProtocol = { type: 'meshcore' } as const;

describe('meshcoreDualNobleBleInit', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    resetNobleBleConnectMutexForTests();
  });

  it('detects Meshtastic Noble BLE still configuring', () => {
    useIdentityStore.setState({
      identities: {
        mt: {
          id: 'mt',
          protocol: meshtasticProtocol as never,
          signature: '1',
          transports: [],
          createdAt: 0,
          lastSeenAt: 0,
        },
      },
      activeIdentityId: 'mt',
    });
    useConnectionStore.setState({
      connections: {
        mt: {
          identityId: 'mt',
          status: 'connected',
          connectionType: 'ble',
          mqttStatus: 'disconnected',
          reconnectAttempt: 0,
          myNodeNum: 1,
        },
      },
    });
    expect(meshtasticNobleBleConfigureBusy()).toBe(true);
  });

  it('ignores configured Meshtastic and MeshCore BLE connections', () => {
    useIdentityStore.setState({
      identities: {
        mt: {
          id: 'mt',
          protocol: meshtasticProtocol as never,
          signature: '1',
          transports: [],
          createdAt: 0,
          lastSeenAt: 0,
        },
        mc: {
          id: 'mc',
          protocol: meshcoreProtocol as never,
          signature: '2',
          transports: [],
          createdAt: 0,
          lastSeenAt: 0,
        },
      },
      activeIdentityId: null,
    });
    useConnectionStore.setState({
      connections: {
        mt: {
          identityId: 'mt',
          status: 'configured',
          connectionType: 'ble',
          mqttStatus: 'disconnected',
          reconnectAttempt: 0,
          myNodeNum: 1,
        },
        mc: {
          identityId: 'mc',
          status: 'connected',
          connectionType: 'ble',
          mqttStatus: 'disconnected',
          reconnectAttempt: 0,
          myNodeNum: 2,
        },
      },
    });
    expect(meshtasticNobleBleConfigureBusy()).toBe(false);
  });

  it('detects MeshCore Noble BLE still configuring', () => {
    useIdentityStore.setState({
      identities: {
        mc: {
          id: 'mc',
          protocol: meshcoreProtocol as never,
          signature: '2',
          transports: [],
          createdAt: 0,
          lastSeenAt: 0,
        },
      },
      activeIdentityId: 'mc',
    });
    useConnectionStore.setState({
      connections: {
        mc: {
          identityId: 'mc',
          status: 'connecting',
          connectionType: 'ble',
          mqttStatus: 'disconnected',
          reconnectAttempt: 0,
          myNodeNum: 2,
        },
      },
    });
    expect(meshcoreNobleBleConfigureBusy()).toBe(true);
    expect(nobleBleConfigureBusyForProtocol('meshcore')).toBe(true);
    expect(nobleBleConfigureBusyForProtocol('meshtastic')).toBe(false);
  });

  it('awaitNobleBleProtocolSettle returns immediately when protocol BLE configure is idle', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    const start = Date.now();
    await awaitNobleBleProtocolSettle('meshcore', 4000);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('awaitNobleBleProtocolSettle waits until MeshCore BLE configure completes', async () => {
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    useIdentityStore.setState({
      identities: {
        mc: {
          id: 'mc',
          protocol: meshcoreProtocol as never,
          signature: '2',
          transports: [],
          createdAt: 0,
          lastSeenAt: 0,
        },
      },
      activeIdentityId: 'mc',
    });
    useConnectionStore.setState({
      connections: {
        mc: {
          identityId: 'mc',
          status: 'connecting',
          connectionType: 'ble',
          mqttStatus: 'disconnected',
          reconnectAttempt: 0,
          myNodeNum: 2,
        },
      },
    });

    const settlePromise = awaitNobleBleProtocolSettle('meshcore', 4000);
    await vi.advanceTimersByTimeAsync(200);
    useConnectionStore.setState({
      connections: {
        mc: {
          identityId: 'mc',
          status: 'configured',
          connectionType: 'ble',
          mqttStatus: 'disconnected',
          reconnectAttempt: 0,
          myNodeNum: 2,
        },
      },
    });
    await vi.advanceTimersByTimeAsync(200);
    await settlePromise;
    expect(nobleBleConfigureBusyForProtocol('meshcore')).toBe(false);
    vi.useRealTimers();
  });

  it('awaitDualNobleBleMeshtasticSettle returns immediately when no Meshtastic BLE configure is active', async () => {
    const start = Date.now();
    await awaitDualNobleBleMeshtasticSettle(4000);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it.each(['darwin', 'win32', 'linux'] as const)(
    'isRendererGattBlePlatform is true on %s (sidecar GATT)',
    (platform) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
      expect(isRendererGattBlePlatform()).toBe(true);
    },
  );

  it('needsSequentialMeshcoreRadioInit is true for serial/TCP only (BLE stays parallel)', () => {
    expect(needsSequentialMeshcoreRadioInit('serial')).toBe(true);
    expect(needsSequentialMeshcoreRadioInit('tcp')).toBe(true);
    expect(needsSequentialMeshcoreRadioInit('ble')).toBe(false);
  });

  it('meshcoreTargetsSharedMeshtasticBlePeripheral when both remember the same BLE id', () => {
    localStorage.setItem('mesh-client:lastBleDevice:meshtastic', 'shared-peripheral');
    localStorage.setItem('mesh-client:lastBleDevice:meshcore', 'shared-peripheral');
    expect(meshcoreTargetsSharedMeshtasticBlePeripheral('shared-peripheral')).toBe(true);
    expect(meshcoreTargetsSharedMeshtasticBlePeripheral('other-peripheral')).toBe(false);
    localStorage.removeItem('mesh-client:lastBleDevice:meshtastic');
    localStorage.removeItem('mesh-client:lastBleDevice:meshcore');
  });

  it('dual-radio primary settle still unblocks secondary without connect mutex', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    localStorage.setItem('mesh-client:lastBleDevice:meshtastic', 'mt-peripheral');
    localStorage.setItem('mesh-client:lastBleDevice:meshcore', 'mc-peripheral');
    localStorage.setItem('mesh-client:protocol', 'meshcore');
    initNobleBleDualRadioStartup();
    expect(getNobleBleDualRadioPrimaryProtocol()).toBe('meshcore');

    const secondaryWait = awaitNobleBlePrimaryAutoConnectSettled(5_000);
    notifyNobleBlePrimaryAutoConnectSettled();
    await expect(secondaryWait).resolves.toBeUndefined();

    localStorage.removeItem('mesh-client:lastBleDevice:meshtastic');
    localStorage.removeItem('mesh-client:lastBleDevice:meshcore');
    localStorage.removeItem('mesh-client:protocol');
  });

  it('dualNobleBleBothRadiosConfigured when both stacks remember different BLE peripherals', () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    localStorage.setItem('mesh-client:lastBleDevice:meshtastic', 'mt-peripheral');
    localStorage.setItem('mesh-client:lastBleDevice:meshcore', 'mc-peripheral');
    expect(dualNobleBleBothRadiosConfigured()).toBe(true);
    localStorage.removeItem('mesh-client:lastBleDevice:meshtastic');
    localStorage.removeItem('mesh-client:lastBleDevice:meshcore');
  });

  it('resolveNobleBleDualRadioPrimaryProtocol uses last active tab when dual-radio', () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    localStorage.setItem('mesh-client:lastBleDevice:meshtastic', 'mt-peripheral');
    localStorage.setItem('mesh-client:lastBleDevice:meshcore', 'mc-peripheral');
    localStorage.setItem('mesh-client:protocol', 'meshcore');
    expect(resolveNobleBleDualRadioPrimaryProtocol()).toBe('meshcore');
    localStorage.setItem('mesh-client:protocol', 'meshtastic');
    expect(resolveNobleBleDualRadioPrimaryProtocol()).toBe('meshtastic');
    localStorage.setItem('mesh-client:protocol', 'reticulum');
    expect(resolveNobleBleDualRadioPrimaryProtocol()).toBe('meshtastic');
    localStorage.removeItem('mesh-client:lastBleDevice:meshtastic');
    localStorage.removeItem('mesh-client:lastBleDevice:meshcore');
    localStorage.removeItem('mesh-client:protocol');
  });

  it('initNobleBleDualRadioStartup is idempotent', () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    localStorage.setItem('mesh-client:lastBleDevice:meshtastic', 'mt-peripheral');
    localStorage.setItem('mesh-client:lastBleDevice:meshcore', 'mc-peripheral');
    localStorage.setItem('mesh-client:protocol', 'meshcore');
    initNobleBleDualRadioStartup();
    expect(getNobleBleDualRadioPrimaryProtocol()).toBe('meshcore');
    localStorage.setItem('mesh-client:protocol', 'meshtastic');
    initNobleBleDualRadioStartup();
    expect(getNobleBleDualRadioPrimaryProtocol()).toBe('meshcore');
    localStorage.removeItem('mesh-client:lastBleDevice:meshtastic');
    localStorage.removeItem('mesh-client:lastBleDevice:meshcore');
    localStorage.removeItem('mesh-client:protocol');
  });

  it('notifyBlePrimaryRfLinkReady unblocks secondary without waiting for configure', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    localStorage.setItem('mesh-client:lastBleDevice:meshtastic', 'mt-peripheral');
    localStorage.setItem('mesh-client:lastBleDevice:meshcore', 'mc-peripheral');
    localStorage.setItem('mesh-client:protocol', 'meshcore');
    initNobleBleDualRadioStartup();
    let secondaryUnblocked = false;
    const secondaryWait = awaitNobleBlePrimaryAutoConnectSettled(5000).then(() => {
      secondaryUnblocked = true;
    });
    await Promise.resolve();
    expect(secondaryUnblocked).toBe(false);
    notifyBlePrimaryRfLinkReady('meshcore');
    await secondaryWait;
    expect(secondaryUnblocked).toBe(true);
    localStorage.removeItem('mesh-client:lastBleDevice:meshtastic');
    localStorage.removeItem('mesh-client:lastBleDevice:meshcore');
    localStorage.removeItem('mesh-client:protocol');
  });

  it('initNobleBleDualRadioStartup marks primaryAutoConnectInFlight in the mutex snapshot', () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    localStorage.setItem('mesh-client:lastBleDevice:meshtastic', 'mt-peripheral');
    localStorage.setItem('mesh-client:lastBleDevice:meshcore', 'mc-peripheral');
    localStorage.setItem('mesh-client:protocol', 'meshtastic');
    initNobleBleDualRadioStartup();
    expect(getNobleBleConnectMutexSnapshot().primaryAutoConnectInFlight).toBe(true);
    expect(getNobleBleConnectMutexSnapshot().primaryProtocol).toBe('meshtastic');
    localStorage.removeItem('mesh-client:lastBleDevice:meshtastic');
    localStorage.removeItem('mesh-client:lastBleDevice:meshcore');
    localStorage.removeItem('mesh-client:protocol');
  });

  it('notifyNobleBlePrimaryAutoConnectSettled clears primaryAutoConnectInFlight in the mutex snapshot', () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    localStorage.setItem('mesh-client:lastBleDevice:meshtastic', 'mt-peripheral');
    localStorage.setItem('mesh-client:lastBleDevice:meshcore', 'mc-peripheral');
    localStorage.setItem('mesh-client:protocol', 'meshtastic');
    initNobleBleDualRadioStartup();
    expect(getNobleBleConnectMutexSnapshot().primaryAutoConnectInFlight).toBe(true);
    notifyNobleBlePrimaryAutoConnectSettled();
    expect(getNobleBleConnectMutexSnapshot().primaryAutoConnectInFlight).toBe(false);
    localStorage.removeItem('mesh-client:lastBleDevice:meshtastic');
    localStorage.removeItem('mesh-client:lastBleDevice:meshcore');
    localStorage.removeItem('mesh-client:protocol');
  });

  it('awaitNobleBlePrimaryAutoConnectSettled unblocks after primary notifies', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    localStorage.setItem('mesh-client:lastBleDevice:meshtastic', 'mt-peripheral');
    localStorage.setItem('mesh-client:lastBleDevice:meshcore', 'mc-peripheral');
    localStorage.setItem('mesh-client:protocol', 'meshtastic');
    initNobleBleDualRadioStartup();
    let secondaryUnblocked = false;
    const secondaryWait = awaitNobleBlePrimaryAutoConnectSettled(5000).then(() => {
      secondaryUnblocked = true;
    });
    await Promise.resolve();
    expect(secondaryUnblocked).toBe(false);
    notifyNobleBlePrimaryAutoConnectSettled();
    await secondaryWait;
    expect(secondaryUnblocked).toBe(true);
    expect(getNobleBleDualRadioPrimaryProtocol()).toBe('meshtastic');
    localStorage.removeItem('mesh-client:lastBleDevice:meshtastic');
    localStorage.removeItem('mesh-client:lastBleDevice:meshcore');
    localStorage.removeItem('mesh-client:protocol');
  });
});
