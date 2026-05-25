import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from '@/renderer/lib/appSettingsStorage';

import {
  hydrateLastRfSelfNodeIdFromAppSettings,
  loadPersistedLastRfSelfNodeId,
  meshtasticMqttOwnNodeIds,
  mqttOnlyIdentitySource,
  persistLastRfSelfNodeId,
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
});
