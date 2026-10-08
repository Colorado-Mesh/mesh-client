import { vi } from 'vitest';

import { useTranslationStore } from '@/renderer/stores/translationStore';
import type { TranslationAPI, TranslationStatus } from '@/shared/translation-types';

export function translationStatus(installed = true): TranslationStatus {
  return {
    enabled: true,
    packs: ['engine', 'fr-en'].map((id) => ({
      id,
      installed,
      downloadBytes: 100,
      diskBytes: installed ? 200 : 0,
      license: 'MPL-2.0',
    })),
    progress: [],
    diskBytes: installed ? 400 : 0,
    libre: { enabled: false, url: '', hasApiKey: false },
  };
}

export function resetTranslation(status = translationStatus()) {
  localStorage.clear();
  useTranslationStore.getState().clear();
  useTranslationStore.setState({
    preferences: { target: 'en', readLanguages: ['en'], auto: false },
  });
  useTranslationStore.getState().setStatus(status);
  const api = {
    getStatus: vi.fn(() => Promise.resolve(status)),
    setEnabled: vi.fn((enabled: boolean) => Promise.resolve({ ...status, enabled })),
    translate: vi.fn<TranslationAPI['translate']>(() =>
      Promise.resolve({
        ok: true,
        text: 'Hello everyone',
        detectedLang: 'fr',
        provider: 'offline',
      }),
    ),
    detect: vi.fn<TranslationAPI['detect']>(() =>
      Promise.resolve({ language: 'fr', confidence: 0.99 }),
    ),
    listPacks: vi.fn(() => Promise.resolve(status.packs)),
    installPack: vi.fn(() => Promise.resolve({ ok: true })),
    cancelInstall: vi.fn(async () => {}),
    deletePack: vi.fn(async () => {}),
    removeAll: vi.fn(() => Promise.resolve({ ...translationStatus(false), enabled: false })),
    setLibreConfig: vi.fn<TranslationAPI['setLibreConfig']>((config) =>
      Promise.resolve({
        ...status,
        libre: { enabled: config.enabled, url: config.url, hasApiKey: Boolean(config.apiKey) },
      }),
    ),
    testLibreConfig: vi.fn(() => Promise.resolve({ ok: true })),
    onPackProgress: vi.fn<TranslationAPI['onPackProgress']>(() => () => {}),
  } satisfies TranslationAPI;
  window.electronAPI.translation = api;
  return api;
}
