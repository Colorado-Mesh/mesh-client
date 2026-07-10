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
  readRmapPublishState,
  readRmapUiPrefs,
  resolveRmapCoordinates,
  ReticulumRmapGpsRequiredError,
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

  it('classifies discovery-capable types and excludes tcp/auto hubs', () => {
    expect(
      isReticulumRmapDiscoveryCapable(row({ id: 'r', type: 'rnode', serial_port: '/dev/ttyUSB0' })),
    ).toBe(true);
    expect(
      isReticulumRmapDiscoveryCapable(row({ id: 'k', type: 'kiss', serial_port: '/dev/kiss' })),
    ).toBe(true);
    expect(isReticulumRmapDiscoveryCapable(row({ id: 'b', type: 'ble_peer' }))).toBe(true);
    expect(isReticulumRmapDiscoveryCapable(row({ id: 'i', type: 'i2p' }))).toBe(true);
    expect(isReticulumRmapDiscoveryCapable(row({ id: 'u', type: 'udp' }))).toBe(true);
    expect(isReticulumRmapDiscoveryCapable(row({ id: 'p', type: 'pipe' }))).toBe(true);
    expect(
      isReticulumRmapDiscoveryCapable(
        row({ id: 't', type: 'tcp', host: 'rmap.world', port: 4242 }),
      ),
    ).toBe(false);
    expect(isReticulumRmapDiscoveryCapable(row({ id: 'a', type: 'auto' }))).toBe(false);
    expect(
      isReticulumRmapDiscoveryCapable(
        row({ id: 'r', type: 'rnode', enabled: false, serial_port: '/dev/ttyUSB0' }),
      ),
    ).toBe(false);
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

  it('readRmapPublishState reflects discoverable publish targets', () => {
    const interfaces = [
      row({ id: 'r', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: true }),
      row({ id: 't', type: 'tcp', host: 'rmap.world', port: 4242, discoverable: false }),
    ];
    expect(readRmapPublishState(interfaces)).toBe(true);
    expect(listReticulumRmapDiscoveryCapable(interfaces)).toHaveLength(1);
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

    await applyReticulumRmapDiscovery({
      interfaces: [row({ id: 'r', type: 'rnode', serial_port: '/dev/ttyUSB0' })],
      announceIntervalMin: 60,
      discoveryName: 'Test',
      stackSettings: { enable_transport: false, share_instance: true, loglevel: 4 },
    });

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

  it('summarizeRmapPublishStatus counts discoverable and needs-sync targets', () => {
    const interfaces = [
      row({ id: 'r1', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: true }),
      row({ id: 'r2', type: 'ble_peer', discoverable: false }),
      row({ id: 't', type: 'tcp', host: 'rmap.world', port: 4242 }),
    ];
    expect(summarizeRmapPublishStatus(interfaces)).toEqual({
      publishing: true,
      discoverableCount: 1,
      publishTargetCount: 2,
      needsSyncCount: 1,
    });
  });

  it('isReticulumRmapNeedsSyncRow when publishing globally but row missing discoverable', () => {
    const interfaces = [
      row({ id: 'r1', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: true }),
      row({ id: 'r2', type: 'ble_peer', discoverable: false }),
    ];
    expect(isReticulumRmapNeedsSyncRow(interfaces[1], interfaces)).toBe(true);
    expect(isReticulumRmapDiscoverableRow(interfaces[0])).toBe(true);
  });

  it('maybeSyncReticulumRmapAfterInterfaceEnable patches when RMAP is on', async () => {
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
