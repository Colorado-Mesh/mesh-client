import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from '../lib/appSettingsStorage';

describe('mapViewportStore', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEY);
  });

  it('loads persisted viewport from app settings', async () => {
    const persisted = { center: [40.123, -105.456], zoom: 12 };
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ mapViewport: persisted }));

    const { useMapViewportStore } = await import('./mapViewportStore');
    expect(useMapViewportStore.getState().viewport).toEqual(persisted);
  });

  it('persists viewport updates to app settings', async () => {
    const { useMapViewportStore } = await import('./mapViewportStore');
    const viewport = { center: [39.999, -104.888] as [number, number], zoom: 9 };
    useMapViewportStore.getState().setViewport(viewport);

    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { mapViewport?: unknown };
    expect(parsed.mapViewport).toEqual(viewport);
  });
});
