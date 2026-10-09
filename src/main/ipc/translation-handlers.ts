import path from 'node:path';

import { app, ipcMain, type IpcMainInvokeEvent, net, safeStorage } from 'electron';

import { MS_PER_MINUTE } from '../../shared/timeConstants';
import {
  type LibreTranslationConfig,
  TRANSLATION_MAX_TEXT_LENGTH,
  type TranslationProgress,
  type TranslationRequest,
  type TranslationStatus,
} from '../../shared/translation-types';
import { isTranslationLanguage } from '../../shared/translationLanguages';
import { createIpcRateLimiter } from '../ipcRateLimit';
import { BergamotWorker } from '../translation/bergamotWorker';
import { LibreTranslateClient } from '../translation/libreTranslateClient';
import { TranslationPackManager } from '../translation/packManager';
import { TranslationRouter } from '../translation/translationRouter';
import { assertIpcSender } from '../validate-ipc-sender';

export interface TranslationHandlerDependencies {
  getSetting: (key: string) => string | undefined;
  setSetting: (key: string, value: string) => void;
  onProgress: (progress: TranslationProgress) => void;
}

export function validateTranslationText(text: unknown): asserts text is string {
  if (typeof text !== 'string' || !text.trim() || text.length > TRANSLATION_MAX_TEXT_LENGTH)
    throw new Error('Invalid translation text');
}
export function validateTranslationRequest(value: unknown): TranslationRequest {
  if (typeof value !== 'object' || value === null || !('text' in value))
    throw new Error('Invalid translation request');
  validateTranslationText(value.text);
  if (
    !('target' in value) ||
    !isTranslationLanguage(value.target) ||
    !('mode' in value) ||
    (value.mode !== 'manual' && value.mode !== 'auto')
  )
    throw new Error('Invalid translation request');
  if ('source' in value && value.source !== undefined && !isTranslationLanguage(value.source))
    throw new Error('Invalid source language');
  if (
    'provider' in value &&
    value.provider !== undefined &&
    value.provider !== 'offline' &&
    value.provider !== 'libre'
  )
    throw new Error('Invalid translation provider');
  return {
    text: value.text,
    target: value.target,
    mode: value.mode === 'auto' ? 'auto' : 'manual',
    ...('source' in value && isTranslationLanguage(value.source) ? { source: value.source } : {}),
    ...('provider' in value && value.provider === 'libre' ? { provider: 'libre' as const } : {}),
  };
}

/**
 * Mozilla's attachment CDN answers Chromium's network stack (`net.fetch`) with HTTP 406, so pack
 * downloads use Node's fetch with a non-browser User-Agent.
 */
export function createTranslationPackFetch(
  version: string,
  fetchImpl?: typeof fetch,
): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('User-Agent', `mesh-client/${version}`);
    return (fetchImpl ?? globalThis.fetch)(input, { ...init, headers });
  };
}

/** Registration is inert: constructing services creates no directory, network request or worker. */
export function registerTranslationHandlers(deps: TranslationHandlerDependencies): () => void {
  const enabled = () => deps.getSetting('translationEnabled') === '1';
  const fetchImpl: typeof fetch = (input, init) =>
    net.fetch(input instanceof URL ? input.href : input, init);
  const packs = new TranslationPackManager({
    directory: () => path.join(app.getPath('userData'), 'translation'),
    enabled,
    fetch: createTranslationPackFetch(app.getVersion()),
    onProgress: deps.onProgress,
  });
  const worker = new BergamotWorker();
  const libre = new LibreTranslateClient({
    fetch: fetchImpl,
    safeStorage,
    read: () => deps.getSetting('translationLibreConfig'),
    write: (value) => {
      deps.setSetting('translationLibreConfig', value);
    },
  });
  const router = new TranslationRouter({ enabled, packs, worker, libre });
  const reads = createIpcRateLimiter({
    max: 180,
    windowMs: MS_PER_MINUTE,
    label: 'translation:read',
  });
  const writes = createIpcRateLimiter({
    max: 60,
    windowMs: MS_PER_MINUTE,
    label: 'translation:write',
  });
  const guard = (event: IpcMainInvokeEvent, channel: string, write = false) => {
    assertIpcSender(event, channel);
    (write ? writes : reads).checkOrThrow();
  };
  const status = async (): Promise<TranslationStatus> => {
    const list = await packs.list();
    return {
      enabled: enabled(),
      packs: list,
      progress: packs.progress(),
      diskBytes: list
        .filter((pack) => pack.installed)
        .reduce((sum, pack) => sum + pack.diskBytes, 0),
      libre: libre.status(),
    };
  };
  const id = (value: unknown) => {
    if (typeof value !== 'string') throw new Error('Invalid pack id');
    packs.pack(value);
    return value;
  };
  ipcMain.handle('translation:getStatus', async (event) => {
    guard(event, 'translation:getStatus');
    return status();
  });
  ipcMain.handle('translation:listPacks', async (event) => {
    guard(event, 'translation:listPacks');
    return packs.list();
  });
  ipcMain.handle('translation:setEnabled', async (event, value: unknown) => {
    guard(event, 'translation:setEnabled', true);
    if (typeof value !== 'boolean') throw new Error('Invalid translation opt-in');
    deps.setSetting('translationEnabled', value ? '1' : '0');
    if (!value) {
      router.dispose();
      await packs.cancelAll();
    }
    return status();
  });
  ipcMain.handle('translation:translate', async (event, value: unknown) => {
    guard(event, 'translation:translate');
    return router.translate(validateTranslationRequest(value));
  });
  ipcMain.handle('translation:detect', async (event, value: unknown) => {
    guard(event, 'translation:detect');
    validateTranslationText(value);
    return router.detect(value);
  });
  ipcMain.handle('translation:installPack', async (event, value: unknown) => {
    guard(event, 'translation:installPack', true);
    return packs.install(id(value));
  });
  ipcMain.handle('translation:cancelInstall', async (event, value: unknown) => {
    guard(event, 'translation:cancelInstall', true);
    await packs.cancel(id(value));
  });
  ipcMain.handle('translation:deletePack', async (event, value: unknown) => {
    guard(event, 'translation:deletePack', true);
    const packId = id(value);
    router.dispose();
    await packs.delete(packId);
  });
  ipcMain.handle('translation:removeAll', async (event) => {
    guard(event, 'translation:removeAll', true);
    deps.setSetting('translationEnabled', '0');
    router.dispose();
    await packs.removeAll();
    libre.clear();
    return status();
  });
  ipcMain.handle('translation:setLibreConfig', async (event, value: unknown) => {
    guard(event, 'translation:setLibreConfig', true);
    if (!enabled()) return status();
    if (
      typeof value !== 'object' ||
      value === null ||
      !('enabled' in value) ||
      typeof value.enabled !== 'boolean' ||
      !('url' in value) ||
      typeof value.url !== 'string' ||
      ('apiKey' in value &&
        value.apiKey !== undefined &&
        (typeof value.apiKey !== 'string' || value.apiKey.length > 1_024))
    )
      throw new Error('Invalid LibreTranslate configuration');
    libre.setConfig(value as LibreTranslationConfig);
    return status();
  });
  ipcMain.handle('translation:testLibreConfig', async (event) => {
    guard(event, 'translation:testLibreConfig', true);
    if (!enabled()) return { ok: false, reason: 'disabled' };
    try {
      await libre.detect('Hello, this is a translation connection test.');
      return { ok: true };
    } catch {
      // catch-no-log-ok report failure without server content, URLs or keys
      return { ok: false, reason: 'error' };
    }
  });
  return () => {
    router.dispose();
    void packs.cancelAll();
  };
}
