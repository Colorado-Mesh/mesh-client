import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addRmapDiscoveredAsInterface,
  buildAddInterfaceBodyFromDiscovered,
  canAddRmapDiscoveredAsInterface,
  formatRmapDiscoveredEndpoint,
} from './reticulumRmapAddDiscovered';

describe('reticulumRmapAddDiscovered', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('canAddRmapDiscoveredAsInterface accepts Backbone with host and port', () => {
    expect(
      canAddRmapDiscoveredAsInterface({
        interface_type: 'BackboneInterface',
        reachable_on: 'hub.example.com',
        port: 4242,
      }),
    ).toBe(true);
    expect(
      canAddRmapDiscoveredAsInterface({
        interface_type: 'TCPServerInterface',
        reachable_on: '10.0.0.1',
        port: 7822,
      }),
    ).toBe(true);
  });

  it('rejects RNode, missing address, script reachable_on, and bad ports', () => {
    expect(
      canAddRmapDiscoveredAsInterface({
        interface_type: 'RNodeInterface',
        reachable_on: 'hub.example.com',
        port: 4242,
      }),
    ).toBe(false);
    expect(
      canAddRmapDiscoveredAsInterface({
        interface_type: 'BackboneInterface',
        reachable_on: null,
        port: 4242,
      }),
    ).toBe(false);
    expect(
      canAddRmapDiscoveredAsInterface({
        interface_type: 'BackboneInterface',
        reachable_on: '/usr/local/bin/get_ip.sh',
        port: 4242,
      }),
    ).toBe(false);
    expect(
      canAddRmapDiscoveredAsInterface({
        interface_type: 'BackboneInterface',
        reachable_on: 'hub.example.com',
        port: 0,
      }),
    ).toBe(false);
  });

  it('buildAddInterfaceBodyFromDiscovered maps IFAC fields', () => {
    expect(
      buildAddInterfaceBodyFromDiscovered({
        discovery_name: 'Sideband Hub',
        interface_type: 'BackboneInterface',
        reachable_on: 'sideband.example.com',
        port: 7822,
        ifac_netname: 'internal_1',
        ifac_netkey: 'secret',
      }),
    ).toEqual({
      type: 'backbone',
      name: 'Sideband Hub',
      enabled: true,
      host: 'sideband.example.com',
      port: 7822,
      network_name: 'internal_1',
      passphrase: 'secret',
    });
  });

  it('formatRmapDiscoveredEndpoint joins host and port', () => {
    expect(formatRmapDiscoveredEndpoint({ reachable_on: 'hub.example.com', port: 4242 })).toBe(
      'hub.example.com:4242',
    );
    expect(formatRmapDiscoveredEndpoint({ reachable_on: 'hub.example.com', port: null })).toBe(
      'hub.example.com',
    );
    expect(formatRmapDiscoveredEndpoint({ reachable_on: null, port: 4242 })).toBeNull();
  });

  it('addRmapDiscoveredAsInterface posts backbone body', async () => {
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('window', {
      electronAPI: { reticulum: { proxyPost } },
    });
    const result = await addRmapDiscoveredAsInterface({
      discovery_hash: 'abc',
      transport_id: '11'.repeat(16),
      network_id: '22'.repeat(16),
      discovery_name: 'Public Hub',
      interface_type: 'BackboneInterface',
      latitude: 0,
      longitude: 0,
      height: 0,
      transport_enabled: true,
      reachable_on: 'hub.example.com',
      port: 4242,
      hops: 1,
      stamp_value: 16,
      discovered: 1,
      last_heard: 2,
      heard_count: 1,
      status: 'available',
      has_coordinates: false,
    });
    expect(result).toEqual({ ok: true });
    expect(proxyPost).toHaveBeenCalledWith('/api/v1/interfaces', {
      type: 'backbone',
      name: 'Public Hub',
      enabled: true,
      host: 'hub.example.com',
      port: 4242,
    });
  });
});
