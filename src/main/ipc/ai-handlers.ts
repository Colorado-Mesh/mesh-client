import path from 'node:path';

import {
  app,
  ipcMain,
  type IpcMainInvokeEvent,
  net,
  protocol,
  safeStorage,
  type WebContents,
} from 'electron';

import {
  AI_MAX_OUTPUT_TOKENS,
  AI_MAX_RESPONSE_BYTES,
  AI_REQUEST_TIMEOUT_MS,
  type AiActionResult,
  type AiOsAiStatus,
  type AiProviderStatus,
} from '../../shared/ai-types';
import { MS_PER_MINUTE, MS_PER_SECOND } from '../../shared/timeConstants';
import { AiClient } from '../ai/aiClient';
import { AiConfig } from '../ai/config';
import { aiErrorReason, AiFailure } from '../ai/errors';
import { querySummaryHistory, validateHistoryQuery } from '../ai/history';
import { AI_LOCAL_MODELS } from '../ai/local/modelManifest';
import { AiModelPackManager } from '../ai/local/modelPackManager';
import { createAiModelProtocol } from '../ai/local/protocol';
import { OsAiHelper } from '../ai/os/osAiHelper';
import { buildSummaryPrompt } from '../ai/promptBuilder';
import { classifyEndpoint, validateAiEndpointUrl } from '../ai/urlPolicy';
import { validateAiConfig, validateAiRequest } from '../ai/validation';
import { getDbForIpc } from '../db-ipc-lifecycle';
import { createIpcRateLimiter } from '../ipcRateLimit';
import { assertIpcSender } from '../validate-ipc-sender';

interface Dependencies {
  getSetting: (key: string) => string | undefined;
  setSetting: (key: string, value: string) => void;
  getWebContents: () => WebContents | undefined;
}
/** Registration has no disk, network, model or subprocess side effects. */
export function registerAiHandlers(deps: Dependencies): () => void {
  const enabled = () => deps.getSetting('aiEnabled') === '1';
  const config = new AiConfig({
    read: () => deps.getSetting('aiProviderConfig'),
    write: (value) => {
      deps.setSetting('aiProviderConfig', value);
    },
    safeStorage,
  });
  const directory = () => path.join(app.getPath('userData'), 'ai-models');
  const send = (channel: string, payload: unknown) => {
    const web = deps.getWebContents();
    if (web && !web.isDestroyed()) web.send(channel, payload);
  };
  const packs = new AiModelPackManager({
    enabled,
    directory,
    fetch: globalThis.fetch,
    onProgress: (progress) => {
      send('ai:modelProgress', progress);
    },
  });
  const client = new AiClient((input, init) =>
    net.fetch(input instanceof URL ? input.href : input, init),
  );
  // OS-specific: Foundation Models and Windows AI APIs require native platform helpers.
  const os = new OsAiHelper(() =>
    path.join(
      app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'),
      app.isPackaged ? 'ai-helper' : 'ai-helper/active',
      process.platform === 'win32' ? 'mesh-ai.exe' : 'mesh-ai',
    ),
  );
  let osStatus: AiOsAiStatus = { available: false, platform: null, reason: 'unsupported-platform' };
  let revision = 0;
  const active = new Map<string, AbortController>();
  const reads = createIpcRateLimiter({ max: 180, windowMs: MS_PER_MINUTE, label: 'ai:read' });
  const writes = createIpcRateLimiter({ max: 60, windowMs: MS_PER_MINUTE, label: 'ai:write' });
  const summaries = createIpcRateLimiter({
    max: 10,
    windowMs: MS_PER_MINUTE,
    label: 'ai:summarize',
  });
  const guard = (event: IpcMainInvokeEvent, channel: string, write = false) => {
    assertIpcSender(event, channel);
    (write ? writes : reads).checkOrThrow();
  };
  const stop = () => {
    revision++;
    for (const controller of active.values()) controller.abort();
    active.clear();
    os.kill();
  };
  const status = async (): Promise<AiProviderStatus> => {
    const c = config.read();
    const selectedModel = AI_LOCAL_MODELS.some((model) => model.id === c.localModelId)
      ? c.localModelId
      : null;
    return {
      enabled: enabled(),
      engine: c.engine,
      wireFormat: c.wireFormat,
      baseUrl: c.baseUrl,
      model: c.model,
      hasApiKey: Boolean(c.encryptedKey),
      allowRemote: c.allowRemote,
      isRemote: (() => {
        const policy = classifyEndpoint(c.baseUrl);
        return policy.ok && policy.cls === 'remote';
      })(),
      localEngine: {
        ready: enabled() && !!selectedModel && (await packs.verify(selectedModel)),
        modelId: selectedModel,
        downloading: packs.progress().length > 0,
      },
      osAi: osStatus,
    };
  };
  const check = async (): Promise<AiActionResult> => {
    if (!enabled()) return { ok: false, reason: 'disabled' };
    const c = config.read();
    if (!c.engine) return { ok: false, reason: 'notConfigured' };
    if (c.engine === 'os') {
      osStatus = await os.probe();
      return { ok: osStatus.available, reason: osStatus.available ? undefined : 'engineNotReady' };
    }
    if (c.engine === 'bundled') {
      const ok = !!c.localModelId && (await packs.verify(c.localModelId));
      return ok ? { ok } : { ok, reason: 'engineNotReady' };
    }
    const policy = validateAiEndpointUrl(c.baseUrl, c.allowRemote);
    if (
      !policy.ok ||
      (c.engine === 'local' && policy.cls !== 'local') ||
      (c.engine === 'remote' && (!c.allowRemote || !c.baseUrl.startsWith('https:')))
    )
      return { ok: false, reason: 'remoteNotAcknowledged' };
    return { ok: !!c.wireFormat && !!c.model, reason: 'notConfigured' };
  };
  const id = (value: unknown) => {
    if (typeof value !== 'string') throw new Error('Invalid AI model');
    packs.pack(value);
    return value;
  };
  ipcMain.handle('ai:getHistory', (event, value: unknown) => {
    guard(event, 'ai:getHistory');
    if (!enabled()) return [];
    const query = validateHistoryQuery(value);
    const db = getDbForIpc('ai:getHistory');
    return db ? querySummaryHistory(db, query) : [];
  });
  ipcMain.handle('ai:getStatus', async (event) => {
    guard(event, 'ai:getStatus');
    return status();
  });
  ipcMain.handle('ai:setEnabled', async (event, value: unknown) => {
    guard(event, 'ai:setEnabled', true);
    if (typeof value !== 'boolean') throw new Error('Invalid AI opt-in');
    deps.setSetting('aiEnabled', value ? '1' : '0');
    stop();
    if (!value) await packs.cancelAll();
    const next = await status();
    send('ai:statusChanged', next);
    return next;
  });
  ipcMain.handle('ai:probeOsAi', async (event) => {
    guard(event, 'ai:probeOsAi');
    if (!enabled()) return osStatus;
    osStatus = await os.probe(true);
    return osStatus;
  });
  ipcMain.handle('ai:setConfig', async (event, value: unknown) => {
    guard(event, 'ai:setConfig', true);
    if (!enabled()) return status();
    const input = validateAiConfig(value);
    if (input.localModelId) id(input.localModelId);
    config.write(input);
    stop();
    const next = await status();
    send('ai:statusChanged', next);
    return next;
  });
  ipcMain.handle('ai:listLocalModels', async (event) => {
    guard(event, 'ai:listLocalModels');
    return enabled() ? packs.list() : [];
  });
  ipcMain.handle('ai:installLocalModel', async (event, value: unknown) => {
    guard(event, 'ai:installLocalModel', true);
    return packs.install(id(value));
  });
  ipcMain.handle('ai:cancelLocalModel', async (event, value: unknown) => {
    guard(event, 'ai:cancelLocalModel', true);
    await packs.cancel(id(value));
  });
  ipcMain.handle('ai:removeLocalModel', async (event, value: unknown) => {
    guard(event, 'ai:removeLocalModel', true);
    stop();
    await packs.delete(id(value));
    const next = await status();
    send('ai:statusChanged', next);
    return enabled() ? packs.list() : [];
  });
  ipcMain.handle('ai:selectLocalModel', async (event, value: unknown) => {
    guard(event, 'ai:selectLocalModel', true);
    if (!enabled()) return status();
    if (value !== null) id(value);
    config.write({ engine: 'bundled', localModelId: value as string | null });
    stop();
    const next = await status();
    send('ai:statusChanged', next);
    return next;
  });
  const endpointModels = async () => {
    if (!enabled()) throw new AiFailure('disabled');
    const c = config.read();
    const policy = validateAiEndpointUrl(c.baseUrl, c.allowRemote);
    if (
      !c.wireFormat ||
      !policy.ok ||
      (c.engine === 'local' && policy.cls !== 'local') ||
      !['local', 'remote'].includes(c.engine ?? '')
    )
      throw new AiFailure('notConfigured');
    const controller = new AbortController();
    const key = crypto.randomUUID();
    active.set(key, controller);
    try {
      return await client.list(
        c.wireFormat,
        {
          baseUrl: c.baseUrl,
          model: c.model,
          apiKey: config.key(),
          system: '',
          user: '',
          maxTokens: 1,
        },
        c.allowRemote,
        AbortSignal.any([controller.signal, AbortSignal.timeout(10 * MS_PER_SECOND)]),
      );
    } finally {
      active.delete(key);
    }
  };
  ipcMain.handle('ai:listEndpointModels', async (event) => {
    guard(event, 'ai:listEndpointModels');
    return endpointModels();
  });
  ipcMain.handle('ai:testConfig', async (event) => {
    guard(event, 'ai:testConfig', true);
    const ready = await check();
    if (!ready.ok) return ready;
    const c = config.read();
    if (c.engine === 'bundled' || c.engine === 'os') return ready;
    try {
      await endpointModels();
      return { ok: true };
    } catch {
      // catch-no-log-ok test failures never expose response bodies
      return {
        ok: false,
        reason: 'httpError',
      };
    }
  });
  ipcMain.handle('ai:cancel', (event, value: unknown) => {
    guard(event, 'ai:cancel', true);
    if (typeof value !== 'string' || value.length > 128) throw new Error('Invalid AI request id');
    active.get(value)?.abort();
  });
  ipcMain.handle('ai:summarize', async (event, value: unknown): Promise<AiActionResult> => {
    guard(event, 'ai:summarize');
    summaries.checkOrThrow();
    const request = validateAiRequest(value);
    if (active.size >= 1) return { ok: false, reason: 'busy' };
    const controller = new AbortController();
    active.set(request.requestId, controller);
    const before = revision;
    let ready: AiActionResult;
    try {
      ready = await check();
    } catch {
      // catch-no-log-ok readiness errors must not expose configuration
      active.delete(request.requestId);
      return { ok: false, reason: 'engineNotReady' };
    }
    if (
      !ready.ok ||
      before !== revision ||
      !enabled() ||
      controller.signal.aborted ||
      !request.messages.length
    ) {
      if (active.get(request.requestId) === controller) active.delete(request.requestId);
      if (!ready.ok) return ready;
      return {
        ok: false,
        reason:
          controller.signal.aborted || before !== revision || !enabled()
            ? 'cancelled'
            : 'noMessages',
      };
    }
    const c = config.read();
    const prompt = buildSummaryPrompt({
      ...request,
      maxChars: c.engine === 'os' ? 9000 : c.engine === 'bundled' ? 20000 : 60000,
      maxPromptBytes: c.engine === 'os' ? 3500 : c.engine === 'bundled' ? 7600 : 64000,
    });
    if (!prompt.included) {
      if (active.get(request.requestId) === controller) active.delete(request.requestId);
      return { ok: false, reason: 'tooLarge' };
    }
    if (c.engine === 'bundled') {
      if (active.get(request.requestId) === controller) active.delete(request.requestId);
      const model = AI_LOCAL_MODELS.find((m) => m.id === c.localModelId)!;
      return {
        ok: true,
        localJob: {
          modelUrl: `mesh-ai://${model.id}/${model.assets[0].file}`,
          system: prompt.system,
          user: prompt.user,
          messageCount: prompt.included,
          truncated: prompt.truncated,
          model: model.name,
        },
      };
    }
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)]);
    void (async () => {
      let text = '';
      let pending = '';
      let timer: ReturnType<typeof setTimeout> | undefined;
      const flush = () => {
        clearTimeout(timer);
        timer = undefined;
        if (pending && before === revision && enabled()) {
          send('ai:summaryChunk', { requestId: request.requestId, delta: pending });
          pending = '';
        }
      };
      const delta = (value: string) => {
        signal.throwIfAborted();
        text += value;
        if (Buffer.byteLength(text) > AI_MAX_RESPONSE_BYTES) throw new AiFailure('tooLarge');
        pending += value;
        if (pending.length >= 24) flush();
        else timer ??= setTimeout(flush, 50);
      };
      try {
        if (c.engine === 'os')
          await os.generate(
            {
              requestId: request.requestId,
              system: prompt.system,
              user: prompt.user,
              maxTokens: AI_MAX_OUTPUT_TOKENS,
            },
            signal,
            delta,
          );
        else {
          if (!c.wireFormat) throw new AiFailure('notConfigured');
          for await (const part of client.stream(
            c.wireFormat,
            {
              baseUrl: c.baseUrl,
              model: c.model,
              apiKey: config.key(),
              system: prompt.system,
              user: prompt.user,
              maxTokens: AI_MAX_OUTPUT_TOKENS,
            },
            c.allowRemote,
            signal,
          ))
            delta(part);
        }
        signal.throwIfAborted();
        if (!text.trim()) throw new AiFailure('invalidResponse');
        flush();
        if (before === revision && enabled())
          send('ai:summaryDone', {
            requestId: request.requestId,
            text,
            provider: c.engine === 'os' ? 'OS AI' : new URL(c.baseUrl).host,
            model: c.engine === 'os' ? (osStatus.modelLabel ?? 'OS AI') : c.model,
            messageCount: prompt.included,
            truncated: prompt.truncated,
          });
      } catch (error) {
        // catch-no-log-ok summaries contain private conversation text
        if (before === revision && enabled())
          send('ai:summaryError', {
            requestId: request.requestId,
            reason: aiErrorReason(error, signal),
          });
      } finally {
        clearTimeout(timer);
        if (active.get(request.requestId) === controller) active.delete(request.requestId);
      }
    })();
    return { ok: true };
  });
  app
    .whenReady()
    .then(() => {
      protocol.handle(
        'mesh-ai',
        createAiModelProtocol({ enabled, directory, packs, fetchFile: (url) => net.fetch(url) }),
      );
    })
    .catch(() => {
      // catch-no-log-ok app shutdown can prevent protocol registration
    });
  return () => {
    stop();
    void packs.cancelAll();
  };
}
