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
import { fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';

import {
  AI_FOLLOW_UP_OUTPUT_TOKENS,
  AI_MAX_RESPONSE_BYTES,
  type AiActionResult,
  type AiOsAiStatus,
  type AiProviderStatus,
  aiSummaryOutputTokens,
  aiSummaryPromptBudget,
  aiSummaryTimeoutMs,
  clampAiMaxCollectedMessages,
  resolveAiSummaryFinalStyle,
} from '../../shared/ai-types';
import { MS_PER_MINUTE, MS_PER_SECOND } from '../../shared/timeConstants';
import { AiClient } from '../ai/aiClient';
import { AiConfig } from '../ai/config';
import { aiErrorReason, AiFailure } from '../ai/errors';
import { querySummaryHistory, validateHistoryQuery } from '../ai/history';
import { loadAiLocalModels } from '../ai/loadAiLocalModels';
import { loadBuildAiFollowUpPrompt } from '../ai/loadFollowUpPrompt';
import { loadBuildAiSummaryPrompt } from '../ai/loadSummaryPrompt';
import { isCatalogPackAvailable } from '../ai/local/modelManifest';
import { AiModelPackManager } from '../ai/local/modelPackManager';
import { createAiModelProtocol } from '../ai/local/protocol';
import { MlxAiHelper } from '../ai/os/mlxAiHelper';
import { OsAiHelper } from '../ai/os/osAiHelper';
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
  const client = new AiClient((input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    // undici honors the pinned lookup dispatcher; Chromium net.fetch does not.
    return undiciFetch(href, init as UndiciRequestInit) as unknown as Promise<Response>;
  });
  const helperRoot = () =>
    path.join(
      app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'),
      app.isPackaged ? 'ai-helper' : 'ai-helper/active',
    );
  // OS-specific: Foundation Models and Windows AI APIs require native platform helpers.
  const os = new OsAiHelper(() =>
    path.join(helperRoot(), process.platform === 'win32' ? 'mesh-ai.exe' : 'mesh-ai'),
  );
  // OS-specific: Apple Silicon MLX Metal Catch up helper (optional staged binary).
  const mlx = new MlxAiHelper(() => path.join(helperRoot(), 'mesh-ai-mlx'));
  let osStatus: AiOsAiStatus = { available: false, platform: null, reason: 'unsupported-platform' };
  let revision = 0;
  const active = new Map<string, AbortController>();
  const reads = createIpcRateLimiter({ max: 180, windowMs: MS_PER_MINUTE, label: 'ai:read' });
  const writes = createIpcRateLimiter({ max: 60, windowMs: MS_PER_MINUTE, label: 'ai:write' });
  const summaries = createIpcRateLimiter({
    max: 120,
    windowMs: MS_PER_MINUTE,
    label: 'ai:summarize',
  });
  /** Parent Catch up jobs whose child map/reduce passes skip the summarize rate limiter. */
  const multiPassJobs = new Set<string>();
  const guard = (event: IpcMainInvokeEvent, channel: string, write = false) => {
    assertIpcSender(event, channel);
    // Summary passes share the parent's admission; other calls use the read/write limits.
    if (channel !== 'ai:summarize') (write ? writes : reads).checkOrThrow();
  };
  const stop = () => {
    revision++;
    for (const controller of active.values()) controller.abort();
    active.clear();
    multiPassJobs.clear();
    os.kill();
    mlx.kill();
  };
  const bundledModelReady = async (modelId: string): Promise<boolean> => {
    const catalog = await loadAiLocalModels();
    const model = catalog.find((entry) => entry.id === modelId);
    if (!model || !isCatalogPackAvailable(model)) return false;
    if (!(await packs.verify(model.id, true))) return false;
    if (model.runtime === 'mlx') return mlx.availableOnHost() && (await mlx.probe());
    return true;
  };
  const mlxPackUsable = (pack: { runtime?: string }) =>
    pack.runtime !== 'mlx' || mlx.availableOnHost();
  const status = async (): Promise<AiProviderStatus> => {
    const c = config.read();
    const catalog = await loadAiLocalModels();
    const selectedPack = catalog.find((model) => model.id === c.localModelId);
    const selectedModel =
      selectedPack && isCatalogPackAvailable(selectedPack) ? selectedPack.id : null;
    return {
      enabled: enabled(),
      engine: c.engine,
      wireFormat: c.wireFormat,
      baseUrl: c.baseUrl,
      model: c.model,
      hasApiKey: Boolean(c.encryptedKey),
      timeoutSeconds: aiSummaryTimeoutMs(c.engine, c.timeoutSeconds) / MS_PER_SECOND,
      maxCollectedMessages: clampAiMaxCollectedMessages(c.maxCollectedMessages),
      allowRemote: c.allowRemote,
      isRemote: (() => {
        const policy = classifyEndpoint(c.baseUrl);
        return policy.ok && policy.cls === 'remote';
      })(),
      localEngine: {
        ready: enabled() && !!selectedModel && (await bundledModelReady(selectedModel)),
        modelId: selectedModel,
        downloading: packs.progress().length > 0,
      },
      mlxHelperAvailable: mlx.availableOnHost(),
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
      const catalog = await loadAiLocalModels();
      const model = catalog.find((entry) => entry.id === c.localModelId);
      const ok =
        !!model &&
        isCatalogPackAvailable(model) &&
        (await packs.verify(model.id)) &&
        (model.runtime !== 'mlx' || (mlx.availableOnHost() && (await mlx.probe())));
      return ok ? { ok } : { ok: false, reason: 'engineNotReady' };
    }
    const policy = validateAiEndpointUrl(c.baseUrl, c.allowRemote);
    if (
      !policy.ok ||
      (c.engine === 'local' && policy.cls !== 'local') ||
      (c.engine === 'remote' && (!c.allowRemote || !c.baseUrl.startsWith('https:')))
    )
      return { ok: false, reason: 'remoteNotAcknowledged' };
    return c.wireFormat && c.model ? { ok: true } : { ok: false, reason: 'notConfigured' };
  };
  const id = async (value: unknown) => {
    if (typeof value !== 'string') throw new Error('Invalid AI model');
    await packs.getPack(value);
    return value;
  };
  /** Catalog packs and retired on-disk orphans share this id grammar. */
  const packDirectoryId = (value: unknown) => {
    if (typeof value !== 'string' || !/^[a-z0-9.-]+$/.test(value))
      throw new Error('Invalid AI model');
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
    if (input.localModelId) {
      const modelId = await id(input.localModelId);
      if (!isCatalogPackAvailable(await packs.getPack(modelId)))
        throw new Error('Invalid AI model');
    }
    config.write(input);
    stop();
    const next = await status();
    send('ai:statusChanged', next);
    return next;
  });
  ipcMain.handle('ai:listLocalModels', async (event) => {
    guard(event, 'ai:listLocalModels');
    if (!enabled()) return [];
    const listed = await packs.list();
    // Hide MLX catalog cards when the Metal helper is missing; keep installed packs for Remove.
    if (mlx.availableOnHost()) return listed;
    return listed.filter((entry) => entry.runtime !== 'mlx' || entry.installed);
  });
  ipcMain.handle('ai:installLocalModel', async (event, value: unknown) => {
    guard(event, 'ai:installLocalModel', true);
    const modelId = await id(value);
    const pack = await packs.getPack(modelId);
    if (!isCatalogPackAvailable(pack) || !mlxPackUsable(pack)) throw new Error('Invalid AI model');
    return packs.install(modelId);
  });
  ipcMain.handle('ai:cancelLocalModel', async (event, value: unknown) => {
    guard(event, 'ai:cancelLocalModel', true);
    await packs.cancel(await id(value));
  });
  ipcMain.handle('ai:removeLocalModel', async (event, value: unknown) => {
    guard(event, 'ai:removeLocalModel', true);
    const modelId = packDirectoryId(value);
    stop();
    await packs.delete(modelId);
    const stored = config.read();
    if (stored.localModelId === modelId) config.clearLocalModelSelection();
    const next = await status();
    send('ai:statusChanged', next);
    return enabled() ? packs.list() : [];
  });
  ipcMain.handle('ai:selectLocalModel', async (event, value: unknown) => {
    guard(event, 'ai:selectLocalModel', true);
    if (!enabled()) return status();
    if (value !== null) {
      const modelId = await id(value);
      const pack = await packs.getPack(modelId);
      if (!isCatalogPackAvailable(pack) || !mlxPackUsable(pack))
        throw new Error('Invalid AI model');
    }
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
    const controller = active.get(value);
    active.delete(value);
    controller?.abort();
  });
  ipcMain.handle('ai:summarize', async (event, value: unknown): Promise<AiActionResult> => {
    guard(event, 'ai:summarize');
    const request = validateAiRequest(value);
    const mode = request.mode ?? 'final';
    const followUp = request.followUp;
    if (request.jobId && multiPassJobs.has(request.jobId)) {
      // Child multi-pass step — already counted when the first map registered the job.
    } else if (request.jobId && mode === 'map') {
      summaries.checkOrThrow();
      if (multiPassJobs.size >= 32) multiPassJobs.delete(multiPassJobs.values().next().value!);
      multiPassJobs.add(request.jobId);
    } else {
      // Follow-ups are single-pass and count like a final pass.
      summaries.checkOrThrow();
    }
    if (active.size >= 1) return { ok: false, reason: 'busy' };
    const controller = new AbortController();
    active.set(request.requestId, controller);
    const before = revision;
    let ready: AiActionResult;
    let cancelReadiness!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancelReadiness = () => {
        reject(new AiFailure('cancelled'));
      };
      controller.signal.addEventListener('abort', cancelReadiness, { once: true });
    });
    try {
      ready = await Promise.race([check(), cancelled]);
    } catch {
      // catch-no-log-ok readiness errors must not expose configuration
      if (active.get(request.requestId) === controller) active.delete(request.requestId);
      return { ok: false, reason: controller.signal.aborted ? 'cancelled' : 'engineNotReady' };
    } finally {
      controller.signal.removeEventListener('abort', cancelReadiness);
    }
    if (
      !ready.ok ||
      before !== revision ||
      !enabled() ||
      controller.signal.aborted ||
      (!request.messages.length && !followUp)
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
    if (!c.engine) {
      if (active.get(request.requestId) === controller) active.delete(request.requestId);
      return { ok: false, reason: 'notConfigured' };
    }
    const budget = aiSummaryPromptBudget(c.engine);
    let finalStyle =
      mode === 'final'
        ? resolveAiSummaryFinalStyle(request.messages.length, !!request.jobId)
        : 'compact';
    const buildSummaryPrompt = await loadBuildAiSummaryPrompt();
    const buildCatchUpPrompt = (style: typeof finalStyle) => ({
      ...buildSummaryPrompt({
        ...request,
        digests: mode === 'reduce' || (mode === 'final' && !!request.jobId),
        mode: request.mode ?? 'final',
        finalStyle: style,
        maxChars: budget.maxChars,
        maxPromptBytes: budget.maxPromptBytes,
      }),
      fits: true as const,
    });
    let prompt = followUp
      ? (await loadBuildAiFollowUpPrompt())({
          conversationLabel: request.conversationLabel,
          protocol: request.protocol,
          surface: request.surface,
          locale: request.locale,
          summary: followUp.summary,
          question: followUp.question,
          turns: followUp.turns,
          messages: request.messages,
          contextKind: followUp.contextKind,
          maxChars: budget.maxChars,
          maxPromptBytes: budget.maxPromptBytes,
        })
      : buildCatchUpPrompt(finalStyle);
    // Structured finals cost ~512 B more system text; fall back to compact when that
    // would truncate digests/transcript and fail multi-pass requireFullCoverage.
    if (
      !followUp &&
      mode === 'final' &&
      finalStyle === 'structured' &&
      (prompt.truncated || prompt.included !== request.messages.length || !prompt.included)
    ) {
      finalStyle = 'compact';
      prompt = buildCatchUpPrompt('compact');
    }
    if (!prompt.fits || (!followUp && !prompt.included)) {
      if (active.get(request.requestId) === controller) active.delete(request.requestId);
      if (request.jobId && request.mode === 'final') multiPassJobs.delete(request.jobId);
      return { ok: false, reason: 'tooLarge' };
    }
    // Qwen3 defaults to thinking mode; disable it so Catch up stays within completion budgets.
    if (
      c.engine === 'bundled' &&
      typeof c.localModelId === 'string' &&
      c.localModelId.startsWith('qwen3-') &&
      !prompt.user.includes('/no_think')
    )
      prompt = { ...prompt, user: `${prompt.user}\n/no_think` };
    const outputTokens = followUp
      ? AI_FOLLOW_UP_OUTPUT_TOKENS
      : aiSummaryOutputTokens(mode, finalStyle);
    const catalog = await loadAiLocalModels();
    const bundledModel = catalog.find((m) => m.id === c.localModelId);
    if (c.engine === 'bundled' && bundledModel?.runtime !== 'mlx') {
      if (active.get(request.requestId) === controller) active.delete(request.requestId);
      if (request.jobId && mode === 'final') multiPassJobs.delete(request.jobId);
      const model = bundledModel!;
      return {
        ok: true,
        summaryInput: { messageCount: prompt.included, truncated: prompt.truncated },
        localJob: {
          modelUrl: `mesh-ai://${model.id}/${model.assets[0].file}`,
          system: prompt.system,
          user: prompt.user,
          messageCount: prompt.included,
          truncated: prompt.truncated,
          model: model.name,
          maxTokens: outputTokens,
        },
      };
    }
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(aiSummaryTimeoutMs(c.engine, c.timeoutSeconds)),
    ]);
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
              maxTokens: outputTokens,
            },
            signal,
            delta,
            aiSummaryTimeoutMs(c.engine, c.timeoutSeconds),
          );
        else if (c.engine === 'bundled' && bundledModel?.runtime === 'mlx') {
          const { promises: fsp } = await import('node:fs');
          const root = await fsp.realpath(directory());
          const modelPath = await fsp.realpath(await packs.packDirectory(bundledModel.id));
          if (!modelPath.startsWith(root + path.sep)) throw new AiFailure('engineNotReady');
          await mlx.generate(
            {
              requestId: request.requestId,
              system: prompt.system,
              user: prompt.user,
              maxTokens: outputTokens,
              modelPath,
            },
            signal,
            delta,
            aiSummaryTimeoutMs(c.engine, c.timeoutSeconds),
          );
        } else {
          if (!c.wireFormat) throw new AiFailure('notConfigured');
          for await (const part of client.stream(
            c.wireFormat,
            {
              baseUrl: c.baseUrl,
              model: c.model,
              apiKey: config.key(),
              system: prompt.system,
              user: prompt.user,
              maxTokens: outputTokens,
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
            provider:
              c.engine === 'os'
                ? 'OS AI'
                : c.engine === 'bundled'
                  ? 'MLX'
                  : new URL(c.baseUrl).host,
            model:
              c.engine === 'os'
                ? (osStatus.modelLabel ?? 'OS AI')
                : c.engine === 'bundled'
                  ? (bundledModel?.name ?? 'MLX')
                  : c.model,
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
        if (request.jobId && mode === 'final') multiPassJobs.delete(request.jobId);
      }
    })();
    return {
      ok: true,
      summaryInput: { messageCount: prompt.included, truncated: prompt.truncated },
    };
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
