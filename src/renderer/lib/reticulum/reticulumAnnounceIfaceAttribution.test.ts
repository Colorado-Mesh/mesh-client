import { afterEach, describe, expect, it } from 'vitest';

import {
  getHotReticulumPeerInterface,
  listEnabledBoundaryInterfaceNames,
  listEnabledDefaultHubInterfaceNames,
  recordReticulumPeerInterfaceSample,
  recordReticulumPeerInterfaceSamplesFromPeersUpdated,
  resetReticulumPeerInterfaceAttributionForTests,
  RETICULUM_PEER_IFACE_CHURN_MIN_SAMPLES,
} from './reticulumAnnounceIfaceAttribution';

describe('reticulumAnnounceIfaceAttribution', () => {
  afterEach(() => {
    resetReticulumPeerInterfaceAttributionForTests();
  });

  it('returns null hot interface below min samples', () => {
    for (let i = 0; i < RETICULUM_PEER_IFACE_CHURN_MIN_SAMPLES - 1; i += 1) {
      recordReticulumPeerInterfaceSample('HubA');
    }
    expect(getHotReticulumPeerInterface()).toBeNull();
  });

  it('returns majority interface when one name dominates', () => {
    for (let i = 0; i < 15; i += 1) {
      recordReticulumPeerInterfaceSample('HubA');
    }
    for (let i = 0; i < 5; i += 1) {
      recordReticulumPeerInterfaceSample('HubB');
    }
    expect(getHotReticulumPeerInterface()).toBe('HubA');
  });

  it('returns null when no majority', () => {
    for (let i = 0; i < 10; i += 1) {
      recordReticulumPeerInterfaceSample('HubA');
    }
    for (let i = 0; i < 10; i += 1) {
      recordReticulumPeerInterfaceSample('HubB');
    }
    expect(getHotReticulumPeerInterface()).toBeNull();
  });

  it('records interface names from peers_updated patches', () => {
    recordReticulumPeerInterfaceSamplesFromPeersUpdated({
      patches: Array.from({ length: RETICULUM_PEER_IFACE_CHURN_MIN_SAMPLES }, () => ({
        destination_hash: 'abc',
        interface: 'NoiseHub',
      })),
    });
    expect(getHotReticulumPeerInterface()).toBe('NoiseHub');
  });

  it('lists enabled boundary and default hub names', () => {
    const interfaces = [
      {
        id: '1',
        name: 'Dublin',
        type: 'tcp',
        enabled: true,
        status: 'up',
        host: 'dublin.connect.reticulum.network',
        port: 4965,
        mode: 'boundary',
      },
      {
        id: '2',
        name: 'Custom',
        type: 'tcp',
        enabled: true,
        status: 'up',
        host: 'example.com',
        port: 4242,
        mode: 'boundary',
      },
      {
        id: '3',
        name: 'RNode',
        type: 'rnode',
        enabled: true,
        status: 'up',
        mode: 'access_point',
      },
      {
        id: '4',
        name: 'Disabled Hub',
        type: 'tcp',
        enabled: false,
        status: 'down',
        host: 'rmap.world',
        port: 4242,
        mode: 'boundary',
      },
    ];
    expect(listEnabledBoundaryInterfaceNames(interfaces)).toEqual(['Dublin', 'Custom']);
    expect(listEnabledDefaultHubInterfaceNames(interfaces)).toEqual(['Dublin']);
  });
});
