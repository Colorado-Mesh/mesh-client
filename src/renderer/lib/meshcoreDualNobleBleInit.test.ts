import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionStore } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import {
  awaitDualNobleBleMeshtasticSettle,
  isRendererNobleBlePlatform,
  meshcoreTargetsSharedMeshtasticBlePeripheral,
  meshtasticNobleBleConfigureBusy,
  needsSequentialMeshcoreRadioInit,
} from './meshcoreDualNobleBleInit';

const meshtasticProtocol = { type: 'meshtastic' } as const;
const meshcoreProtocol = { type: 'meshcore' } as const;

describe('meshcoreDualNobleBleInit', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
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

  it('awaitDualNobleBleMeshtasticSettle returns immediately when no Meshtastic BLE configure is active', async () => {
    const start = Date.now();
    await awaitDualNobleBleMeshtasticSettle(4000);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('isRendererNobleBlePlatform follows electronAPI.getPlatform over process.platform', () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    expect(isRendererNobleBlePlatform()).toBe(true);
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    expect(isRendererNobleBlePlatform()).toBe(false);
  });

  it('needsSequentialMeshcoreRadioInit is true for serial and Linux Web Bluetooth only', () => {
    expect(needsSequentialMeshcoreRadioInit('serial')).toBe(true);
    expect(needsSequentialMeshcoreRadioInit('tcp')).toBe(false);
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    expect(needsSequentialMeshcoreRadioInit('ble')).toBe(false);
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    expect(needsSequentialMeshcoreRadioInit('ble')).toBe(true);
  });

  it('meshcoreTargetsSharedMeshtasticBlePeripheral when both remember the same BLE id', () => {
    localStorage.setItem('mesh-client:lastBleDevice:meshtastic', 'shared-peripheral');
    localStorage.setItem('mesh-client:lastBleDevice:meshcore', 'shared-peripheral');
    expect(meshcoreTargetsSharedMeshtasticBlePeripheral('shared-peripheral')).toBe(true);
    expect(meshcoreTargetsSharedMeshtasticBlePeripheral('other-peripheral')).toBe(false);
    localStorage.removeItem('mesh-client:lastBleDevice:meshtastic');
    localStorage.removeItem('mesh-client:lastBleDevice:meshcore');
  });
});
