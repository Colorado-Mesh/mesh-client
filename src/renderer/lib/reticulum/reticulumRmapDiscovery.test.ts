// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GPS_SETTINGS_STORAGE_KEY } from '@/renderer/lib/gpsSource';
import {
  applyReticulumRmapDiscovery,
  buildRmapDisablePatch,
  buildRmapDiscoveryPatch,
  clampRmapAnnounceIntervalMin,
  disableReticulumRmapDiscovery,
  isReticulumRmapDiscoverableRow,
  isReticulumRmapDiscoveryCapable,
  isReticulumRmapLoRaDiscoveryRow,
  isReticulumRmapNeedsSyncRow,
  listReticulumRmapDiscoveryCapable,
  maybeSyncReticulumRmapAfterInterfaceEnable,
  readRmapAnyPublishing,
  readRmapPublishPartial,
  readRmapPublishState,
  readRmapUiPrefs,
  resolveRmapCoordinates,
  ReticulumRmapGpsRequiredError,
  rmapPublishCoverageTone,
  setReticulumRmapDiscoverableForInterface,
  summarizeRmapPublishStatus,
  validateRmapReachableOn,
} from '@/renderer/lib/reticulum/reticulumRmapDiscovery';
import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';
import { createElectronAPIMock } from '@/renderer/vitest.electronApiMock';

function row(
  partial: Partial<ReticulumInterfaceRow> & Pick<ReticulumInterfaceRow, 'id' | 'type'>,
): ReticulumInterfaceRow {
  return {
    name: partial.name ?? partial.id,
    enabled: partial.enabled ?? true,
    status: partial.status ?? 'up',
    ...partial,
  };
}

const ELIGIBLE_CAPABLE_CASES: {
  id: string;
  type: string;
  serial_port?: string;
}[] = [
  { id: 'rnode', type: 'rnode', serial_port: '/dev/ttyUSB0' },
  { id: 'rnode_multi', type: 'rnode_multi', serial_port: '/dev/ttyUSB1' },
  { id: 'kiss', type: 'kiss', serial_port: '/dev/kiss' },
  { id: 'ble_peer', type: 'ble_peer' },
  { id: 'i2p', type: 'i2p' },
  { id: 'udp', type: 'udp' },
  { id: 'pipe', type: 'pipe' },
];

describe('reticulumRmapDiscovery', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
    window.electronAPI = createElectronAPIMock();
  });

  it.each(ELIGIBLE_CAPABLE_CASES)(
    'isReticulumRmapDiscoveryCapable is true for $type',
    ({ id, type, serial_port }) => {
      expect(
        isReticulumRmapDiscoveryCapable(row({ id, type, serial_port: serial_port ?? null })),
      ).toBe(true);
    },
  );

  it.each([
    { id: 'tcp', type: 'tcp', host: 'rmap.world', port: 4242 },
    { id: 'auto', type: 'auto' },
    { id: 'rnode-disabled', type: 'rnode', enabled: false, serial_port: '/dev/ttyUSB0' },
    { id: 'rnode-noserial', type: 'rnode', serial_port: '' },
    { id: 'kiss-noserial', type: 'kiss', serial_port: '   ' },
  ] as const)('isReticulumRmapDiscoveryCapable is false for $id', (partial) => {
    expect(isReticulumRmapDiscoveryCapable(row({ ...partial }))).toBe(false);
  });

  it('classifies LoRa discovery rows for transport bridge', () => {
    expect(isReticulumRmapLoRaDiscoveryRow(row({ id: 'r', type: 'rnode' }))).toBe(true);
    expect(isReticulumRmapLoRaDiscoveryRow(row({ id: 'i', type: 'i2p' }))).toBe(false);
    expect(isReticulumRmapLoRaDiscoveryRow(row({ id: 'u', type: 'udp' }))).toBe(false);
  });

  it('buildRmapDiscoveryPatch sets discovery fields and I2P connectable', () => {
    const rnodePatch = buildRmapDiscoveryPatch(row({ id: 'r', type: 'rnode' }), {
      coords: { lat: 40, lon: -105 },
      discoveryName: 'Node A',
      announceIntervalMin: 90,
      heightMeters: 1600,
      reachableOn: 'mesh.example.com',
      discoverable: true,
    });
    expect(rnodePatch.discoverable).toBe(true);
    expect(rnodePatch.latitude).toBe(40);
    expect(rnodePatch.announce_interval_min).toBe(90);
    expect(rnodePatch.connectable).toBeUndefined();

    const i2pPatch = buildRmapDiscoveryPatch(row({ id: 'i', type: 'i2p' }), {
      coords: { lat: 48.8, lon: 2.3 },
      announceIntervalMin: 360,
      discoverable: true,
    });
    expect(i2pPatch.connectable).toBe(true);
  });

  it('buildRmapDisablePatch only clears discoverable', () => {
    expect(buildRmapDisablePatch()).toEqual({ discoverable: false });
  });

  it('resolveRmapCoordinates reads static GPS from localStorage', () => {
    localStorage.setItem(
      GPS_SETTINGS_STORAGE_KEY,
      JSON.stringify({ staticLat: 39.7392, staticLon: -104.9903 }),
    );
    expect(resolveRmapCoordinates()).toEqual({ lat: 39.7392, lon: -104.9903 });
    localStorage.removeItem(GPS_SETTINGS_STORAGE_KEY);
    expect(resolveRmapCoordinates()).toBeNull();
  });

  it('readRmapPublishState is true only when every eligible interface is discoverable', () => {
    const full = [
      row({ id: 'r', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: true }),
      row({ id: 'b', type: 'ble_peer', discoverable: true }),
      row({ id: 't', type: 'tcp', host: 'rmap.world', port: 4242, discoverable: false }),
    ];
    expect(readRmapPublishState(full)).toBe(true);
    expect(readRmapAnyPublishing(full)).toBe(true);
    expect(readRmapPublishPartial(full)).toBe(false);

    const partial = [
      row({ id: 'r', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: true }),
      row({ id: 'b', type: 'ble_peer', discoverable: false }),
      row({ id: 't', type: 'tcp', host: 'rmap.world', port: 4242 }),
    ];
    expect(readRmapPublishState(partial)).toBe(false);
    expect(readRmapAnyPublishing(partial)).toBe(true);
    expect(readRmapPublishPartial(partial)).toBe(true);

    const none = [
      row({ id: 'r', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: false }),
      row({ id: 't', type: 'tcp', host: 'rmap.world', port: 4242 }),
    ];
    expect(readRmapPublishState(none)).toBe(false);
    expect(readRmapAnyPublishing(none)).toBe(false);
    expect(readRmapPublishPartial(none)).toBe(false);
    expect(listReticulumRmapDiscoveryCapable(none)).toHaveLength(1);
  });

  it('clampRmapAnnounceIntervalMin enforces bounds', () => {
    expect(clampRmapAnnounceIntervalMin(30)).toBe(60);
    expect(clampRmapAnnounceIntervalMin(2000)).toBe(1440);
    expect(clampRmapAnnounceIntervalMin(120)).toBe(120);
  });

  it('validateRmapReachableOn accepts hostname and script paths', () => {
    expect(validateRmapReachableOn('rmap.example.com')).toBeNull();
    expect(validateRmapReachableOn('/opt/bin/my-ip.sh')).toBeNull();
    expect(validateRmapReachableOn('bad host')).toBe('invalid_host');
  });

  it('applyReticulumRmapDiscovery throws without GPS and skips writes', async () => {
    const put = vi.fn();
    window.electronAPI.reticulum.proxyPut = put;
    await expect(
      applyReticulumRmapDiscovery({
        interfaces: [row({ id: 'r', type: 'rnode', serial_port: '/dev/ttyUSB0' })],
        announceIntervalMin: 360,
        stackSettings: { enable_transport: true, share_instance: true, loglevel: 4 },
      }),
    ).rejects.toBeInstanceOf(ReticulumRmapGpsRequiredError);
    expect(put).not.toHaveBeenCalled();
  });

  it('applyReticulumRmapDiscovery patches every eligible type and skips tcp hub', async () => {
    localStorage.setItem(
      GPS_SETTINGS_STORAGE_KEY,
      JSON.stringify({ staticLat: 40, staticLon: -105 }),
    );
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({});
    window.electronAPI.reticulum.proxyPost = vi.fn().mockResolvedValue({ id: 'hub-new' });

    const interfaces = [
      row({ id: 'r', type: 'rnode', serial_port: '/dev/ttyUSB0' }),
      row({ id: 'k', type: 'kiss', serial_port: '/dev/kiss' }),
      row({ id: 'b', type: 'ble_peer' }),
      row({ id: 'i', type: 'i2p' }),
      row({ id: 'u', type: 'udp' }),
      row({ id: 'p', type: 'pipe' }),
      row({ id: 'rm', type: 'rnode_multi', serial_port: '/dev/ttyACM0' }),
      row({ id: 't', type: 'tcp', host: 'rmap.world', port: 4242 }),
    ];
    const result = await applyReticulumRmapDiscovery({
      interfaces,
      announceIntervalMin: 60,
      discoveryName: 'Test',
      stackSettings: { enable_transport: true, share_instance: true, loglevel: 4 },
    });

    expect(result.applied).toBe(7);
    expect(result.total).toBe(7);
    expect(result.errors).toEqual([]);
    for (const id of ['r', 'k', 'b', 'i', 'u', 'p', 'rm']) {
      expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith(
        `/api/v1/interfaces/${id}`,
        expect.objectContaining({ discoverable: true, latitude: 40 }),
      );
    }
    expect(window.electronAPI.reticulum.proxyPut).not.toHaveBeenCalledWith(
      '/api/v1/interfaces/t',
      expect.anything(),
    );
  });

  it('applyReticulumRmapDiscovery patches interfaces and enables transport + hub', async () => {
    localStorage.setItem(
      GPS_SETTINGS_STORAGE_KEY,
      JSON.stringify({ staticLat: 40, staticLon: -105 }),
    );
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({});
    window.electronAPI.reticulum.proxyPost = vi.fn().mockResolvedValue({ id: 'hub-new' });
    window.electronAPI.reticulum.proxyGet = vi.fn().mockResolvedValue({
      enable_transport: false,
      share_instance: true,
      loglevel: 4,
    });

    const result = await applyReticulumRmapDiscovery({
      interfaces: [row({ id: 'r', type: 'rnode', serial_port: '/dev/ttyUSB0' })],
      announceIntervalMin: 60,
      discoveryName: 'Test',
      stackSettings: { enable_transport: false, share_instance: true, loglevel: 4 },
    });

    expect(result.applied).toBe(1);
    expect(result.errors).toEqual([]);

    expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith('/api/v1/stack/settings', {
      enable_transport: true,
      share_instance: true,
      loglevel: 4,
    });
    expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith(
      '/api/v1/interfaces/r',
      expect.objectContaining({ discoverable: true, latitude: 40, announce_interval_min: 60 }),
    );
    expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledWith(
      '/api/v1/interfaces',
      expect.objectContaining({ host: 'rmap.world', port: 4242, enabled: true }),
    );
  });

  it('disableReticulumRmapDiscovery clears discoverable only on publish targets', async () => {
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({});
    await disableReticulumRmapDiscovery([
      row({ id: 'r', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: true }),
      row({ id: 't', type: 'tcp', host: 'x', port: 4242, discoverable: false }),
    ]);
    expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith('/api/v1/interfaces/r', {
      discoverable: false,
    });
  });

  it('summarizeRmapPublishStatus and rmapPublishCoverageTone cover off/partial/full', () => {
    const partial = [
      row({ id: 'r1', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: true }),
      row({ id: 'r2', type: 'ble_peer', discoverable: false }),
      row({ id: 't', type: 'tcp', host: 'rmap.world', port: 4242 }),
    ];
    const partialSummary = summarizeRmapPublishStatus(partial);
    expect(partialSummary).toEqual({
      publishing: true,
      discoverableCount: 1,
      publishTargetCount: 2,
      needsSyncCount: 1,
    });
    expect(rmapPublishCoverageTone(partialSummary)).toBe('partial');

    const full = [
      row({ id: 'r1', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: true }),
      row({ id: 'r2', type: 'ble_peer', discoverable: true }),
      row({ id: 't', type: 'tcp', host: 'rmap.world', port: 4242 }),
    ];
    const fullSummary = summarizeRmapPublishStatus(full);
    expect(fullSummary.discoverableCount).toBe(2);
    expect(fullSummary.publishTargetCount).toBe(2);
    expect(rmapPublishCoverageTone(fullSummary)).toBe('full');

    const off = [
      row({ id: 'r1', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: false }),
      row({ id: 't', type: 'tcp', host: 'rmap.world', port: 4242 }),
    ];
    const offSummary = summarizeRmapPublishStatus(off);
    expect(offSummary.publishing).toBe(false);
    expect(rmapPublishCoverageTone(offSummary)).toBe('off');
  });

  // Driver online lag (e.g. BLE RNode still coming up) surfaces as status: 'down'
  // while discoverable remains true — UI Publishing must stay on so users do not
  // toggle RMAP off mid-bring-up. Announce timing is fixed in rsReticulum.
  it("summarizeRmapPublishStatus stays publishing when discoverable iface is 'down'", () => {
    const interfaces = [
      row({
        id: 'r1',
        type: 'rnode',
        serial_port: '/dev/ttyUSB0',
        discoverable: true,
        status: 'down',
      }),
      row({ id: 't', type: 'tcp', host: 'rmap.world', port: 4242 }),
    ];
    expect(summarizeRmapPublishStatus(interfaces)).toEqual({
      publishing: true,
      discoverableCount: 1,
      publishTargetCount: 1,
      needsSyncCount: 0,
    });
    expect(rmapPublishCoverageTone(summarizeRmapPublishStatus(interfaces))).toBe('full');
  });

  it('isReticulumRmapNeedsSyncRow when any publishing but row missing discoverable', () => {
    const interfaces = [
      row({ id: 'r1', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: true }),
      row({ id: 'r2', type: 'ble_peer', discoverable: false }),
    ];
    expect(isReticulumRmapNeedsSyncRow(interfaces[1], interfaces)).toBe(true);
    expect(isReticulumRmapDiscoverableRow(interfaces[0])).toBe(true);
    // Network all-checked is false while maybeSync intent (any publishing) is true
    expect(readRmapPublishState(interfaces)).toBe(false);
    expect(readRmapAnyPublishing(interfaces)).toBe(true);
  });

  it('maybeSyncReticulumRmapAfterInterfaceEnable patches when any interface is publishing', async () => {
    localStorage.setItem(
      GPS_SETTINGS_STORAGE_KEY,
      JSON.stringify({ staticLat: 40, staticLon: -105 }),
    );
    window.electronAPI.reticulum.proxyGet = vi.fn().mockResolvedValue({
      interfaces: [
        row({ id: 'r1', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: true }),
        row({ id: 'r2', type: 'ble_peer', discoverable: false }),
      ],
    });
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({});
    const synced = await maybeSyncReticulumRmapAfterInterfaceEnable('r2', {
      discoveryName: 'Node',
    });
    expect(synced).toBe(true);
    expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith(
      '/api/v1/interfaces/r2',
      expect.objectContaining({ discoverable: true, latitude: 40 }),
    );
  });

  it('maybeSyncReticulumRmapAfterInterfaceEnable skips when RMAP is off', async () => {
    window.electronAPI.reticulum.proxyGet = vi.fn().mockResolvedValue({
      interfaces: [row({ id: 'r2', type: 'ble_peer', discoverable: false })],
    });
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({});
    const synced = await maybeSyncReticulumRmapAfterInterfaceEnable('r2', {});
    expect(synced).toBe(false);
    expect(window.electronAPI.reticulum.proxyPut).not.toHaveBeenCalled();
  });

  it('readRmapUiPrefs uses defaults when unset', () => {
    expect(readRmapUiPrefs()).toEqual({
      announceIntervalMin: 360,
      reachableOn: '',
      heightMeters: null,
    });
  });

  it('setReticulumRmapDiscoverableForInterface enables I2P without rmap.world hub', async () => {
    localStorage.setItem(
      GPS_SETTINGS_STORAGE_KEY,
      JSON.stringify({ staticLat: 48.8, staticLon: 2.3 }),
    );
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({});
    window.electronAPI.reticulum.proxyPost = vi.fn();
    await setReticulumRmapDiscoverableForInterface(row({ id: 'i2p-1', type: 'i2p' }), true, {
      interfaces: [],
      stackSettings: { enable_transport: false, share_instance: true, loglevel: 4 },
    });
    expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith(
      '/api/v1/interfaces/i2p-1',
      expect.objectContaining({ discoverable: true, connectable: true }),
    );
    expect(window.electronAPI.reticulum.proxyPost).not.toHaveBeenCalled();
  });

  it('setReticulumRmapDiscoverableForInterface enables LoRa row and rmap.world hub', async () => {
    localStorage.setItem(
      GPS_SETTINGS_STORAGE_KEY,
      JSON.stringify({ staticLat: 40, staticLon: -105 }),
    );
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({});
    window.electronAPI.reticulum.proxyPost = vi.fn().mockResolvedValue({ id: 'hub-new' });
    window.electronAPI.reticulum.proxyGet = vi.fn().mockResolvedValue({});
    await setReticulumRmapDiscoverableForInterface(
      row({ id: 'r1', type: 'rnode', serial_port: '/dev/ttyUSB0' }),
      true,
      {
        interfaces: [],
        stackSettings: { enable_transport: false, share_instance: true, loglevel: 4 },
      },
    );
    expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith('/api/v1/stack/settings', {
      enable_transport: true,
      share_instance: true,
      loglevel: 4,
    });
    expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalled();
    expect(isReticulumRmapLoRaDiscoveryRow(row({ id: 'r1', type: 'rnode' }))).toBe(true);
  });
});
