// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { setConnection, useConnectionStore } from '@/renderer/stores/connectionStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';

import {
  hasEnabledReticulumBleInterface,
  isMeshBleConnected,
  isReticulumBleBusyErrorMessage,
  isReticulumBleInterfaceRow,
  meshBleBlockedByReticulum,
} from './reticulumBleAdapterConflict';

describe('reticulumBleAdapterConflict', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
  });

  it('detects enabled ble_peer and ble:// rnode interfaces', () => {
    expect(
      hasEnabledReticulumBleInterface([
        { type: 'tcp', enabled: true, serial_port: null },
        { type: 'ble_peer', enabled: false },
      ]),
    ).toBe(false);

    expect(isReticulumBleInterfaceRow({ type: 'ble_peer', enabled: true })).toBe(true);
    expect(
      isReticulumBleInterfaceRow({
        type: 'rnode',
        enabled: true,
        serial_port: 'ble://AA:BB:CC:DD:EE:FF',
      }),
    ).toBe(true);

    expect(
      hasEnabledReticulumBleInterface([
        { type: 'ble_peer', enabled: true, seed_addresses: [] } as never,
      ]),
    ).toBe(true);

    expect(
      hasEnabledReticulumBleInterface([
        {
          type: 'rnode',
          enabled: true,
          serial_port: 'ble://AA:BB:CC:DD:EE:FF',
        },
      ]),
    ).toBe(true);
  });

  it('detects active mesh BLE connections', () => {
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

    expect(isMeshBleConnected()).toBe(true);
    expect(meshBleBlockedByReticulum([{ type: 'ble_peer', enabled: true }])).toBe(true);
  });

  it('ignores reticulum identities and non-BLE transports', () => {
    useIdentityStore.setState({
      identities: {
        ret: {
          id: 'ret',
          protocol: { type: 'reticulum' } as never,
          signature: 'r',
          transports: [],
          createdAt: 0,
          lastSeenAt: 0,
        },
        mt: {
          id: 'mt',
          protocol: { type: 'meshtastic' } as never,
          signature: '1',
          transports: [],
          createdAt: 0,
          lastSeenAt: 0,
        },
      },
      activeIdentityId: null,
    });
    setConnection('mt', {
      status: 'connected',
      connectionType: 'serial',
      mqttStatus: 'disconnected',
      reconnectAttempt: 0,
      myNodeNum: 1,
    });

    expect(isMeshBleConnected()).toBe(false);
  });

  it('detects reticulum adapter busy messages', () => {
    expect(isReticulumBleBusyErrorMessage('Bluetooth adapter is in use by Reticulum BLE')).toBe(
      true,
    );
    expect(isReticulumBleBusyErrorMessage('GATT Error')).toBe(false);
  });
});
