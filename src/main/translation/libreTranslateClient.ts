import { validateLibreTranslationUrl } from '../../shared/libreTranslationUrl';
import { MS_PER_SECOND } from '../../shared/timeConstants';
import type { LibreTranslationConfig, TranslationDetection } from '../../shared/translation-types';

interface StoredLibreConfig {
  enabled: boolean;
  url: string;
  encryptedKey?: string;
}
export interface LibreDependencies {
  fetch: typeof fetch;
  read: () => string | undefined;
  write: (value: string) => void;
  safeStorage: {
    isEncryptionAvailable(): boolean;
    encryptString(text: string): Buffer;
    decryptString(bytes: Buffer): string;
    getSelectedStorageBackend?: () => string;
  };
  timeoutMs?: number;
}

/** Keys remain encrypted in main; errors never echo URLs, request bodies or server responses. */
export class LibreTranslateClient {
  private abort = new AbortController();
  constructor(private readonly deps: LibreDependencies) {}

  private config(): StoredLibreConfig {
    const raw = this.deps.read();
    if (!raw) return { enabled: false, url: '' };
    try {
      const value: unknown = JSON.parse(raw);
      if (
        typeof value === 'object' &&
        value !== null &&
        'enabled' in value &&
        typeof value.enabled === 'boolean' &&
        'url' in value &&
        typeof value.url === 'string'
      ) {
        return {
          enabled: value.enabled,
          url: value.url,
          ...('encryptedKey' in value && typeof value.encryptedKey === 'string'
            ? { encryptedKey: value.encryptedKey }
            : {}),
        };
      }
    } catch {
      // catch-no-log-ok invalid saved configuration disables online translation
    }
    return { enabled: false, url: '' };
  }

  status(): { enabled: boolean; url: string; hasApiKey: boolean } {
    const config = this.config();
    return { enabled: config.enabled, url: config.url, hasApiKey: Boolean(config.encryptedKey) };
  }

  setConfig(config: LibreTranslationConfig): void {
    const url = config.url ? validateLibreTranslationUrl(config.url) : '';
    if (config.enabled && !url) throw new Error('LibreTranslate URL required');
    const previous = this.config();
    let encryptedKey = previous.url === url ? previous.encryptedKey : undefined;
    if (config.apiKey !== undefined) {
      if (!config.apiKey) encryptedKey = undefined;
      else {
        if (
          !this.deps.safeStorage.isEncryptionAvailable() ||
          this.deps.safeStorage.getSelectedStorageBackend?.() === 'basic_text'
        )
          throw new Error('OS key storage unavailable');
        encryptedKey = this.deps.safeStorage.encryptString(config.apiKey).toString('base64');
      }
    }
    this.dispose();
    this.deps.write(JSON.stringify({ enabled: config.enabled, url, encryptedKey }));
  }

  clear(): void {
    this.dispose();
    this.deps.write('');
  }
  dispose(): void {
    this.abort.abort();
    this.abort = new AbortController();
  }

  async translate(text: string, source: string, target: string): Promise<string> {
    const value = await this.post('translate', { q: text, source, target, format: 'text' });
    if (
      typeof value !== 'object' ||
      value === null ||
      !('translatedText' in value) ||
      typeof value.translatedText !== 'string' ||
      value.translatedText.length > 32_768
    )
      throw new Error('Invalid LibreTranslate response');
    return value.translatedText;
  }

  async detect(text: string): Promise<TranslationDetection> {
    const value = await this.post('detect', { q: text });
    if (!Array.isArray(value)) throw new Error('Invalid LibreTranslate detection');
    const first: unknown = value[0];
    if (
      typeof first !== 'object' ||
      first === null ||
      !('language' in first) ||
      typeof first.language !== 'string' ||
      !('confidence' in first) ||
      typeof first.confidence !== 'number' ||
      !Number.isFinite(first.confidence)
    )
      throw new Error('Invalid LibreTranslate detection');
    return {
      language: first.language,
      confidence: Math.min(1, Math.max(0, first.confidence / 100)),
    };
  }

  private async post(endpoint: string, body: Record<string, string>): Promise<unknown> {
    const config = this.config();
    if (!config.enabled) throw new Error('LibreTranslate disabled');
    const url = validateLibreTranslationUrl(config.url);
    const key = config.encryptedKey
      ? this.deps.safeStorage.decryptString(Buffer.from(config.encryptedKey, 'base64'))
      : undefined;
    const signal = AbortSignal.any([
      this.abort.signal,
      AbortSignal.timeout(this.deps.timeoutMs ?? 15 * MS_PER_SECOND),
    ]);
    const response = await this.deps.fetch(`${url}/${endpoint}`, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...(key ? { api_key: key } : {}) }),
    });
    if (!response.ok || !response.body) throw new Error('LibreTranslate request failed');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.length;
        if (total > 128 * 1024) throw new Error('LibreTranslate response too large');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }
}
