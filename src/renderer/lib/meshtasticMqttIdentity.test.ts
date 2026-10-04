import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from '@/renderer/lib/appSettingsStorage';

import {
  hydrateLastRfSelfNodeIdFromAppSettings,
  loadPersistedLastRfSelfNodeId,
  loadPreviousRfSelfNodeIds,
  meshtasticMqttOwnNodeIds,
  mqttOnlyIdentitySource,
  parsePreviousRfSelfNodeIdsRaw,
  persistLastRfSelfNodeId,
  resolveMeshtasticOutboundFromNodeId,
  resolveMqttOnlyFromNodeId,
} from './meshtasticMqttIdentity';

describe('resolveMqttOnlyFromNodeId', () => {
  it('prefers last RF node id when set', () => {
    expect(resolveMqttOnlyFromNodeId(0x88cb6530, 0x0b2f75f3)).toBe(0x88cb6530);
  });

  it('falls back to virtual id when no RF session', () => {
    expect(resolveMqttOnlyFromNodeId(0, 0x0b2f75f3)).toBe(0x0b2f75f3);
  });
});

describe('mqttOnlyIdentitySource', () => {
  it('reports lastRf when RF node id is known', () => {
    expect(mqttOnlyIdentitySource(0x123)).toBe('lastRf');
  });

  it('reports virtual when RF node id is zero', () => {
    expect(mqttOnlyIdentitySource(0)).toBe('virtual');
  });
});

const VIRTUAL_ID = 0x0b2f75f3;
const REAL_ID = 0x88cb6530;

describe('resolveMeshtasticOutboundFromNodeId', () => {
  it('uses MQTT-only resolver when no device', () => {
    expect(
      resolveMeshtasticOutboundFromNodeId({
        hasDevice: false,
        myNodeNum: VIRTUAL_ID,
        lastRfSelfNodeId: 0,
        virtualNodeId: VIRTUAL_ID,
      }),
    ).toBe(VIRTUAL_ID);
  });

  it('prefers last RF over virtual when MQTT-only', () => {
    expect(
      resolveMeshtasticOutboundFromNodeId({
        hasDevice: false,
        myNodeNum: REAL_ID,
        lastRfSelfNodeId: REAL_ID,
        virtualNodeId: VIRTUAL_ID,
      }),
    ).toBe(REAL_ID);
  });

  it('uses real myNodeNum when device connected and not virtual', () => {
    expect(
      resolveMeshtasticOutboundFromNodeId({
        hasDevice: true,
        myNodeNum: REAL_ID,
        lastRfSelfNodeId: REAL_ID,
        virtualNodeId: VIRTUAL_ID,
      }),
    ).toBe(REAL_ID);
  });

  it('does not publish virtual from during device connect race (myNodeNum still virtual)', () => {
    expect(
      resolveMeshtasticOutboundFromNodeId({
        hasDevice: true,
        myNodeNum: VIRTUAL_ID,
        lastRfSelfNodeId: 0,
        virtualNodeId: VIRTUAL_ID,
      }),
    ).toBe(0);
  });

  it('falls back to last RF when device connected but myNodeNum still virtual', () => {
    expect(
      resolveMeshtasticOutboundFromNodeId({
        hasDevice: true,
        myNodeNum: VIRTUAL_ID,
        lastRfSelfNodeId: REAL_ID,
        virtualNodeId: VIRTUAL_ID,
      }),
    ).toBe(REAL_ID);
  });
});

describe('meshtasticMqttOwnNodeIds', () => {
  it('includes virtual id only when last RF is unknown', () => {
    expect(meshtasticMqttOwnNodeIds(0x0b2f75f3, 0x0b2f75f3, 0)).toEqual([0x0b2f75f3]);
  });

  it('excludes stale virtual id when last RF identity is active', () => {
    expect(meshtasticMqttOwnNodeIds(0x88cb6530, 0x0b2f75f3, 0x88cb6530)).toEqual([0x88cb6530]);
  });

  it('deduplicates self and last RF when equal', () => {
    expect(meshtasticMqttOwnNodeIds(0x88cb6530, 0x0b2f75f3, 0x88cb6530)).toEqual([0x88cb6530]);
  });
});

describe('last RF persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.appSettings.set).mockClear();
  });

  it('loads persisted last RF node id from app settings', () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ meshtasticLastRfSelfNodeId: '2295031088' }),
    );
    expect(loadPersistedLastRfSelfNodeId()).toBe(0x88cb6530);
  });

  it('persists last RF node id to app settings and SQLite IPC', () => {
    persistLastRfSelfNodeId(0x88cb6530);
    const saved = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      string
    >;
    expect(saved.meshtasticLastRfSelfNodeId).toBe('2295031088');
    expect(window.electronAPI.appSettings.set).toHaveBeenCalledWith(
      'meshtasticLastRfSelfNodeId',
      '2295031088',
    );
  });

  it('hydrates last RF from SQLite app settings into localStorage', async () => {
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValueOnce({
      meshtasticLastRfSelfNodeId: '2295031088',
    });
    await expect(hydrateLastRfSelfNodeIdFromAppSettings()).resolves.toBe(0x88cb6530);
    const saved = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      string
    >;
    expect(saved.meshtasticLastRfSelfNodeId).toBe('2295031088');
  });

  it('does not hydrate invalid SQLite last RF values into localStorage', async () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ meshtasticLastRfSelfNodeId: '111' }),
    );
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValueOnce({
      meshtasticLastRfSelfNodeId: 'not-a-node-id',
    });
    await expect(hydrateLastRfSelfNodeIdFromAppSettings()).resolves.toBe(0x6f);
    const saved = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      string
    >;
    expect(saved.meshtasticLastRfSelfNodeId).toBe('111');
  });

  it('keeps prior own node numbers when the radio is renumbered', () => {
    persistLastRfSelfNodeId(0x11111111);
    persistLastRfSelfNodeId(0x11111111);
    expect(loadPreviousRfSelfNodeIds()).toEqual([]);

    persistLastRfSelfNodeId(0x22222222);
    persistLastRfSelfNodeId(0x33333333);
    expect(loadPersistedLastRfSelfNodeId()).toBe(0x33333333);
    expect(loadPreviousRfSelfNodeIds()).toEqual([0x22222222, 0x11111111]);
    expect(window.electronAPI.appSettings.set).toHaveBeenCalledWith(
      'meshtasticPreviousRfSelfNodeIds',
      JSON.stringify([0x22222222, 0x11111111]),
    );

    persistLastRfSelfNodeId(0x11111111);
    expect(loadPreviousRfSelfNodeIds()).toEqual([0x33333333, 0x22222222]);
  });

  it('ignores corrupt previous-id history', () => {
    expect(parsePreviousRfSelfNodeIdsRaw('not json')).toEqual([]);
    expect(parsePreviousRfSelfNodeIdsRaw('[0, "x", 5, 5, 4294967295]')).toEqual([5]);
  });
});

describe('meshtasticMqttOwnNodeIds with previous ids', () => {
  it('treats previous own node numbers as own', () => {
    expect(meshtasticMqttOwnNodeIds(0x33, 0x0b2f75f3, 0x33, [0x22, 0x11])).toEqual([
      0x33, 0x22, 0x11,
    ]);
  });
});
