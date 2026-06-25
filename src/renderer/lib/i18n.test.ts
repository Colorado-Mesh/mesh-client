import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the dependencies before importing i18n
vi.mock('./appSettingsStorage', () => ({
  getAppSettingsRaw: vi.fn(() => null),
}));

vi.mock('./parseStoredJson', () => ({
  parseStoredJson: vi.fn((raw: string | null) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }),
}));

vi.mock('./defaultAppSettings', () => ({
  DEFAULT_APP_SETTINGS_SHARED: { locale: 'en' },
}));

import type { i18n as I18nType } from 'i18next';

import { getAppSettingsRaw } from './appSettingsStorage';
import { ensureLocaleLoaded } from './localeResources';

describe('i18n', () => {
  let i18n: I18nType;

  beforeAll(async () => {
    vi.mocked(getAppSettingsRaw).mockReturnValue(null);
    i18n = (await import('./i18n')).default;
  });

  beforeEach(async () => {
    vi.mocked(getAppSettingsRaw).mockReturnValue(null);
    await i18n.changeLanguage('en');
  });

  it('resolves English keys correctly', () => {
    expect(i18n.t('common.close')).toBe('Close');
    expect(i18n.t('common.cancel')).toBe('Cancel');
    expect(i18n.t('aria.closeDialog')).toBe('Close dialog');
  });

  it('falls back to English for missing keys', async () => {
    await i18n.changeLanguage('xx');
    expect(i18n.t('common.close')).toBe('Close');
  });

  it('initialises with stored locale from localStorage', async () => {
    vi.resetModules();
    vi.mocked(getAppSettingsRaw).mockReturnValue(JSON.stringify({ locale: 'de' }));
    const { default: freshI18n } = await import('./i18n');
    expect(freshI18n.language).toBe('de');
  });

  it('defaults to English when localStorage is empty', async () => {
    vi.resetModules();
    vi.mocked(getAppSettingsRaw).mockReturnValue(null);
    const { default: freshI18n } = await import('./i18n');
    expect(freshI18n.language).toBe('en');
  });

  it('supports language switching', async () => {
    const en = i18n.t('common.close');
    await ensureLocaleLoaded(i18n, 'fr');
    await i18n.changeLanguage('fr');
    expect(typeof i18n.t('common.close')).toBe('string');
    await i18n.changeLanguage('en');
    expect(i18n.t('common.close')).toBe(en);
  });

  it('handles interpolation correctly', () => {
    expect(i18n.t('telemetryPanel.footerBattery', { count: 42 })).toBe('Battery: 42 pts');
    expect(i18n.t('radioPanel.actionFailed', { message: 'timeout' })).toBe('Failed: timeout');
  });
});
