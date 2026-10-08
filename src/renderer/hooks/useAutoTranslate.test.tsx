import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  resetTranslation,
  translationStatus,
} from '@/renderer/lib/translation/translationTestFixtures';
import { useTranslationStore } from '@/renderer/stores/translationStore';

import { useAutoTranslate } from './useAutoTranslate';

const text = 'Bonjour à tous, comment allez-vous aujourd’hui ?';
describe('visible offline auto translation', () => {
  beforeEach(() => {
    resetTranslation();
  });
  it.each(['linux', 'darwin', 'win32'])('is inert until enabled with packs on %s', async () => {
    const api = resetTranslation({ ...translationStatus(false), enabled: false });
    renderHook(() => {
      useAutoTranslate('off', text, true);
    });
    await act(async () => {});
    expect(api.detect).not.toHaveBeenCalled();
    expect(api.translate).not.toHaveBeenCalled();
  });
  it('does no detection when only the engine is installed', async () => {
    const status = translationStatus(false);
    status.packs[0].installed = true;
    const api = resetTranslation(status);
    useTranslationStore
      .getState()
      .setPreferences({ target: 'en', readLanguages: ['en'], auto: true });
    renderHook(() => {
      useAutoTranslate('missing-packs', text, true);
    });
    await act(async () => {});
    expect(api.detect).not.toHaveBeenCalled();
  });
  it('uses offline only, skips read languages and does not repeat on rerender', async () => {
    const status = translationStatus();
    status.libre.enabled = true;
    const api = resetTranslation(status);
    useTranslationStore
      .getState()
      .setPreferences({ target: 'en', readLanguages: ['en'], auto: true });
    const { rerender } = renderHook(() => {
      useAutoTranslate('visible', text, true);
    });
    await waitFor(() => {
      expect(api.translate).toHaveBeenCalledTimes(1);
    });
    expect(api.translate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'auto', provider: 'offline', source: 'fr' }),
    );
    rerender();
    await act(async () => {});
    expect(api.translate).toHaveBeenCalledTimes(1);
    act(() => {
      useTranslationStore
        .getState()
        .setPreferences({ target: 'en', readLanguages: ['fr'], auto: true });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.detect).toHaveBeenCalledTimes(1);
    expect(api.translate).toHaveBeenCalledTimes(1);
  });
  it('rejoins queued work after hidden-row cleanup and StrictMode remount', async () => {
    const api = resetTranslation();
    useTranslationStore
      .getState()
      .setPreferences({ target: 'en', readLanguages: ['en'], auto: true });
    let finish!: (value: { language: string; confidence: number }) => void;
    api.detect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const blocker = renderHook(() => {
      useAutoTranslate('blocker', text, true);
    });
    await waitFor(() => {
      expect(api.detect).toHaveBeenCalledTimes(1);
    });
    const row = renderHook(() => {
      useAutoTranslate('revisited', text + ' Merci.', true);
    });
    row.unmount();
    renderHook(
      () => {
        useAutoTranslate('revisited', text + ' Merci.', true);
      },
      {
        wrapper: StrictMode,
      },
    );
    await act(async () => {
      finish({ language: 'fr', confidence: 1 });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(api.translate).toHaveBeenCalledTimes(2);
    });
    blocker.unmount();
  });
  it('admits the new generation after changing target with a full deferred queue', async () => {
    const status = translationStatus();
    status.packs.push({
      id: 'en-de',
      installed: true,
      downloadBytes: 1,
      diskBytes: 1,
      license: 'MPL-2.0',
    });
    const api = resetTranslation(status);
    useTranslationStore
      .getState()
      .setPreferences({ target: 'en', readLanguages: ['en'], auto: true });
    let finish!: (value: { language: string; confidence: number }) => void;
    api.detect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const rows = Array.from({ length: 20 }, (_, i) =>
      renderHook(() => {
        useAutoTranslate(`changed:${i}`, `${text} ${i}`, true);
      }),
    );
    await waitFor(() => {
      expect(api.detect).toHaveBeenCalledTimes(1);
    });
    act(() => {
      useTranslationStore
        .getState()
        .setPreferences({ target: 'de', readLanguages: ['en'], auto: true });
    });
    await act(async () => {
      finish({ language: 'fr', confidence: 1 });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(api.translate).toHaveBeenCalledTimes(20);
    });
    expect(api.translate.mock.calls.every(([request]) => request.target === 'de')).toBe(true);
    rows.forEach((row) => {
      row.unmount();
    });
  });
  it('caps a visible burst at twenty and skips low-confidence detection', async () => {
    const api = resetTranslation();
    useTranslationStore
      .getState()
      .setPreferences({ target: 'en', readLanguages: ['en'], auto: true });
    let finish!: (value: { language: string; confidence: number }) => void;
    api.detect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const rows = Array.from({ length: 25 }, (_, i) =>
      renderHook(() => {
        useAutoTranslate(`burst:${i}`, `${text} ${i}`, true);
      }),
    );
    await waitFor(() => {
      expect(api.detect).toHaveBeenCalledTimes(1);
    });
    api.detect.mockResolvedValue({ language: 'fr', confidence: 0.2 });
    await act(async () => {
      finish({ language: 'fr', confidence: 0.2 });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(api.detect).toHaveBeenCalledTimes(20);
    });
    expect(api.translate).not.toHaveBeenCalled();
    rows.forEach((row) => {
      row.unmount();
    });
  });
});
