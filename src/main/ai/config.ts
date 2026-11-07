import type { AiEndpointConfig, AiEngine, AiWireFormat } from '../../shared/ai-types';
import { classifyEndpoint } from './urlPolicy';

export interface StoredAiConfig {
  engine: AiEngine | null;
  wireFormat: AiWireFormat | null;
  baseUrl: string;
  model: string;
  timeoutSeconds?: number;
  maxCollectedMessages?: number;
  encryptedKey?: string;
  allowRemote: boolean;
  localModelId: string | null;
}
interface ConfigDependencies {
  read: () => string | undefined;
  write: (value: string) => void;
  safeStorage: {
    isEncryptionAvailable(): boolean;
    encryptString(text: string): Buffer;
    decryptString(bytes: Buffer): string;
    getSelectedStorageBackend?: () => string;
  };
}
export const EMPTY_AI_CONFIG: StoredAiConfig = {
  engine: null,
  wireFormat: null,
  baseUrl: '',
  model: '',
  allowRemote: false,
  localModelId: null,
};
export class AiConfig {
  constructor(private readonly deps: ConfigDependencies) {}
  read(): StoredAiConfig {
    try {
      const value: unknown = JSON.parse(this.deps.read() ?? 'null');
      if (!value || typeof value !== 'object') return { ...EMPTY_AI_CONFIG };
      const c = value as Partial<StoredAiConfig>;
      // Missing engine (e.g. a partial write that omitted it) must not wipe timeouts /
      // selected model / keys — only reject when the durable string fields are corrupt.
      if (typeof c.baseUrl !== 'string' || typeof c.model !== 'string')
        return { ...EMPTY_AI_CONFIG };
      const engine: AiEngine | null =
        c.engine === 'os' || c.engine === 'bundled' || c.engine === 'local' || c.engine === 'remote'
          ? c.engine
          : null;
      return {
        engine,
        wireFormat: ['openai', 'anthropic', 'gemini', 'ollama'].includes(c.wireFormat ?? '')
          ? c.wireFormat!
          : null,
        baseUrl: c.baseUrl,
        model: c.model,
        ...(typeof c.timeoutSeconds === 'number' ? { timeoutSeconds: c.timeoutSeconds } : {}),
        ...(typeof c.maxCollectedMessages === 'number'
          ? { maxCollectedMessages: c.maxCollectedMessages }
          : {}),
        allowRemote: c.allowRemote === true,
        localModelId: typeof c.localModelId === 'string' ? c.localModelId : null,
        ...(typeof c.encryptedKey === 'string' ? { encryptedKey: c.encryptedKey } : {}),
      };
    } catch {
      // catch-no-log-ok corrupt settings stay dormant
      return { ...EMPTY_AI_CONFIG };
    }
  }
  /**
   * Drop the selected downloaded pack without rewriting engine / endpoint / key fields.
   * Full `write({ localModelId: null })` used to omit `engine` (JSON drops undefined) and
   * reset the provider, which hid the offline catalog after removing an orphan pack.
   */
  clearLocalModelSelection(): void {
    const old = this.read();
    this.deps.write(
      JSON.stringify({
        engine: old.engine,
        wireFormat: old.wireFormat,
        baseUrl: old.baseUrl,
        model: old.model,
        ...(typeof old.timeoutSeconds === 'number' ? { timeoutSeconds: old.timeoutSeconds } : {}),
        ...(typeof old.maxCollectedMessages === 'number'
          ? { maxCollectedMessages: old.maxCollectedMessages }
          : {}),
        ...(typeof old.encryptedKey === 'string' ? { encryptedKey: old.encryptedKey } : {}),
        allowRemote: old.allowRemote,
        localModelId: null,
      } satisfies StoredAiConfig),
    );
  }
  write(input: AiEndpointConfig): void {
    const old = this.read();
    let baseUrl = '';
    if (input.engine === 'local' || input.engine === 'remote') {
      const policy = classifyEndpoint(input.baseUrl ?? '');
      if (
        !policy.ok ||
        (input.engine === 'local' && policy.cls !== 'local') ||
        (input.engine === 'remote' && (!input.allowRemote || !policy.url.startsWith('https:')))
      )
        throw new Error('Invalid AI endpoint or acknowledgment');
      baseUrl = policy.url;
    }
    let encryptedKey =
      old.baseUrl === baseUrl && old.engine === input.engine ? old.encryptedKey : undefined;
    if (input.apiKey !== undefined) {
      encryptedKey = undefined;
      if (input.apiKey) {
        if (
          !this.deps.safeStorage.isEncryptionAvailable() ||
          this.deps.safeStorage.getSelectedStorageBackend?.() === 'basic_text'
        )
          throw new Error('OS key storage unavailable');
        encryptedKey = this.deps.safeStorage.encryptString(input.apiKey).toString('base64');
      }
    }
    this.deps.write(
      JSON.stringify({
        engine: input.engine,
        wireFormat: input.wireFormat ?? null,
        baseUrl,
        model: input.model ?? '',
        timeoutSeconds: input.timeoutSeconds ?? old.timeoutSeconds,
        maxCollectedMessages: input.maxCollectedMessages ?? old.maxCollectedMessages,
        encryptedKey,
        allowRemote: input.engine === 'remote' && input.allowRemote === true,
        localModelId: input.localModelId === undefined ? old.localModelId : input.localModelId,
      } satisfies StoredAiConfig),
    );
  }
  key(): string | undefined {
    const key = this.read().encryptedKey;
    return key ? this.deps.safeStorage.decryptString(Buffer.from(key, 'base64')) : undefined;
  }
}
