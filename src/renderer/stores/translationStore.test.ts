import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetTranslation,
  translationStatus,
} from '@/renderer/lib/translation/translationTestFixtures';

import {
  refreshTranslationStatus,
  translateMessage,
  TRANSLATION_CACHE_CAP,
  useTranslationStore,
} from './translationStore';

describe('translation cache and status', () => {
  beforeEach(() => {
    resetTranslation();
  });
  it('evicts oldest messages, toggles and clears on preference changes', () => {
    const store = useTranslationStore.getState();
    for (let i = 0; i <= TRANSLATION_CACHE_CAP; i++)
      store.setMessage(String(i), { loading: false, showTranslation: true });
    expect(useTranslationStore.getState().messages.size).toBe(TRANSLATION_CACHE_CAP);
    expect(useTranslationStore.getState().messages.has('0')).toBe(false);
    store.toggle('1');
    expect(useTranslationStore.getState().messages.get('1')?.showTranslation).toBe(false);
    store.setPreferences({ target: 'fr', readLanguages: ['fr'], auto: false });
    expect(useTranslationStore.getState().messages.size).toBe(0);
    expect(
      JSON.parse(localStorage.getItem('mesh-client:appSettings') ?? '{}').translationTargetLanguage,
    ).toBe('fr');
  });
  it('deduplicates requests, caches successful results and evicts at the cap', async () => {
    const api = window.electronAPI.translation;
    await Promise.all([
      translateMessage('one', 'Bonjour à tous'),
      translateMessage('one', 'Bonjour à tous'),
    ]);
    await translateMessage('two', 'Bonjour à tous');
    expect(api.translate).toHaveBeenCalledTimes(1);
    for (let i = 0; i <= TRANSLATION_CACHE_CAP; i++)
      await translateMessage(String(i), `Bonjour message ${i}`);
    expect(useTranslationStore.getState().cache.size).toBe(TRANSLATION_CACHE_CAP);
  });
  it('discards an inference completed after settings change', async () => {
    const api = resetTranslation();
    let finish!: (value: Awaited<ReturnType<typeof api.translate>>) => void;
    api.translate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const request = translateMessage('late', 'Bonjour à tous');
    await vi.waitFor(() => {
      expect(api.translate).toHaveBeenCalled();
    });
    useTranslationStore.getState().clear();
    finish({ ok: true, text: 'Hello', detectedLang: 'fr', provider: 'offline' });
    await request;
    expect(useTranslationStore.getState().messages.size).toBe(0);
    expect(useTranslationStore.getState().cache.size).toBe(0);
  });
  it('rejects stale pre-delete status and performs a fresh refresh', async () => {
    const api = resetTranslation();
    let finish!: (status: ReturnType<typeof translationStatus>) => void;
    api.getStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = refreshTranslationStatus();
    const deleted = translationStatus(false);
    useTranslationStore.getState().setStatus(deleted);
    api.getStatus.mockResolvedValue(deleted);
    await refreshTranslationStatus(true);
    finish(translationStatus(true));
    await old;
    expect(api.getStatus).toHaveBeenCalledTimes(2);
    expect(useTranslationStore.getState().status?.packs.every((pack) => !pack.installed)).toBe(
      true,
    );
  });
});
