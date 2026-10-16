import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';
import {
  refreshAiStatus,
  subscribeAiEvents,
  useAiSummaryStore,
} from '@/renderer/stores/aiSummaryStore';
import type {
  AiEndpointConfig,
  AiEngine,
  AiModelInfo,
  AiModelProgress,
  AiWireFormat,
} from '@/shared/ai-types';

import { Button } from './ui/Button';
import { CHECKBOX_CLASS, INPUT_BOX_CLASS, SELECT_BOX_CLASS } from './ui/formClasses';

export function AppAiSection() {
  const { t } = useTranslation();
  const status = useAiSummaryStore((s) => s.status);
  const [open, setOpen] = useState(false);
  const [engine, setEngine] = useState<AiEngine | ''>(status?.engine ?? '');
  const [format, setFormat] = useState<AiWireFormat>(status?.wireFormat ?? 'openai');
  const [baseUrl, setBaseUrl] = useState(status?.baseUrl ?? '');
  const [model, setModel] = useState(status?.model ?? '');
  const [apiKey, setApiKey] = useState<string | undefined>();
  const [ack, setAck] = useState(status?.allowRemote ?? false);
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [progress, setProgress] = useState<AiModelProgress[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const enabled = status?.enabled === true;
  const probed = useRef(false);
  useEffect(() => {
    if (open)
      void refreshAiStatus().catch(() => {
        setNotice(t('aiSummary.settingsError'));
      });
  }, [open, t]);
  useEffect(
    () =>
      useAiSummaryStore.subscribe((state, previous) => {
        const next = state.status;
        if (!next || next === previous.status) return;
        const configuration = (value: typeof next | null) =>
          JSON.stringify([
            value?.engine ?? null,
            value?.wireFormat ?? null,
            value?.baseUrl ?? '',
            value?.model ?? '',
            value?.allowRemote ?? false,
          ]);
        if (configuration(next) === configuration(previous.status)) return;
        setEngine(next.engine ?? '');
        setFormat(next.wireFormat ?? 'openai');
        setBaseUrl(next.baseUrl);
        setModel(next.model);
        setAck(next.allowRemote);
      }),
    [],
  );
  useEffect(() => {
    if (!open || !enabled) return;
    subscribeAiEvents();
    let cancelled = false;
    const load = async () => {
      const list = await window.electronAPI.ai.listLocalModels();
      if (!cancelled) setModels(list);
      if (!probed.current) {
        probed.current = true;
        await window.electronAPI.ai.probeOsAi();
        if (!cancelled) await refreshAiStatus();
      }
    };
    void load().catch(() => {
      if (!cancelled) setNotice(t('aiSummary.settingsError'));
    });
    const unsub = window.electronAPI.ai.onModelProgress((value) => {
      if (cancelled) return;
      setProgress((old) => [...old.filter((p) => p.modelId !== value.modelId), value]);
      if (value.state === 'installed' || value.state === 'cancelled' || value.state === 'error')
        void window.electronAPI.ai.listLocalModels().then(setModels, () => {
          setNotice(t('aiSummary.settingsError'));
        });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [enabled, open, t]);
  const action = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await work();
    } catch {
      // catch-no-log-ok IPC errors may include provider details; display fixed guidance
      setNotice(t('aiSummary.settingsError'));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!engine) return;
    const input: AiEndpointConfig = {
      engine,
      wireFormat: format,
      baseUrl,
      model,
      allowRemote: ack,
      ...(apiKey !== undefined ? { apiKey } : {}),
      localModelId: status?.localEngine.modelId,
    };
    const next = await window.electronAPI.ai.setConfig(input);
    useAiSummaryStore.getState().setStatus(next);
    setApiKey(undefined);
    setNotice(t('aiSummary.saved'));
  };
  return (
    <details
      data-setting-anchor="app.aiProvider"
      className="group bg-deep-black border-secondary-dark rounded-lg border"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="text-ink-200 hover:bg-ink-800/40 flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <h3>{t('aiSummary.settingsTitle')}</h3>
        <DetailsChevron className="text-muted h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-ink-700 border-t px-4 pt-3 pb-4">
        <label
          data-setting-anchor="app.aiProvider.enabled"
          className="flex items-center gap-2 text-sm"
        >
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            aria-label={t('aiSummary.enabled')}
            checked={enabled}
            disabled={busy}
            onChange={(event) => {
              const checked = event.target.checked;
              void action(async () => {
                const next = await window.electronAPI.ai.setEnabled(checked);
                useAiSummaryStore.getState().setStatus(next);
                if (checked) subscribeAiEvents();
              });
            }}
          />
          {t('aiSummary.enabled')}
        </label>
        <p className="text-muted mt-2 text-xs">{t('aiSummary.optIn')}</p>
        {enabled && (
          <div className="mt-3 space-y-3">
            <label data-setting-anchor="app.aiProvider.engine" className="block text-sm">
              {t('aiSummary.engine')}
              <select
                aria-label={t('aiSummary.engine')}
                className={`${SELECT_BOX_CLASS} mt-1 w-full`}
                value={engine}
                onChange={(event) => {
                  setEngine(event.target.value as AiEngine | '');
                  setAck(false);
                  setApiKey(undefined);
                }}
              >
                <option value="">{t('aiSummary.chooseEngine')}</option>
                {status.osAi.available && (
                  <option value="os">
                    {t('aiSummary.osEngine')} ({status.osAi.modelLabel})
                  </option>
                )}
                <option value="bundled">{t('aiSummary.bundledEngine')}</option>
                <option value="local">{t('aiSummary.localEngine')}</option>
                <option value="remote">{t('aiSummary.remoteEngine')}</option>
              </select>
            </label>
            <div data-setting-anchor="app.aiProvider.osAi" className="text-muted text-xs">
              {t('aiSummary.osAvailability', {
                model: status.osAi.available
                  ? status.osAi.modelLabel
                  : t('aiSummary.osUnavailable'),
              })}
            </div>
            {engine === 'bundled' && (
              <div data-setting-anchor="app.aiProvider.catalog" className="space-y-3">
                <h4 className="text-sm font-medium">{t('aiSummary.catalog')}</h4>
                <p className="text-muted text-xs">{t('aiSummary.offlineHint')}</p>
                {models.map((item) => {
                  const p = progress.find((p) => p.modelId === item.id);
                  const downloading = p && ['queued', 'downloading', 'verifying'].includes(p.state);
                  return (
                    <div key={item.id} className="border-ink-700 rounded-lg border p-2 text-sm">
                      <p>{item.name}</p>
                      <p className="text-muted text-xs">
                        {item.paramsLabel} · {(item.downloadBytes / 1024 / 1024).toFixed(0)} MB ·{' '}
                        {item.license}
                      </p>
                      <p className="text-muted text-xs">
                        {item.id === 'qwen2.5-0.5b-instruct-q4'
                          ? t('aiSummary.smallModel')
                          : t('aiSummary.balancedModel')}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {downloading ? (
                          <>
                            <progress
                              aria-label={t('aiSummary.download')}
                              value={p.receivedBytes}
                              max={p.totalBytes}
                            />
                            <Button
                              size="sm"
                              aria-label={t('aiSummary.cancel')}
                              onClick={() => {
                                void action(async () => {
                                  await window.electronAPI.ai.cancelLocalModel(item.id);
                                });
                              }}
                            >
                              {t('aiSummary.cancel')}
                            </Button>
                          </>
                        ) : item.installed ? (
                          <>
                            <Button
                              size="sm"
                              disabled={busy}
                              aria-label={t('aiSummary.useModel', { model: item.name })}
                              onClick={() => {
                                void action(async () => {
                                  useAiSummaryStore
                                    .getState()
                                    .setStatus(
                                      await window.electronAPI.ai.selectLocalModel(item.id),
                                    );
                                });
                              }}
                            >
                              {status.localEngine.modelId === item.id
                                ? t('aiSummary.selected')
                                : t('aiSummary.select')}
                            </Button>
                            <Button
                              size="sm"
                              disabled={busy}
                              aria-label={t('aiSummary.removeModel', { model: item.name })}
                              onClick={() => {
                                void action(async () => {
                                  setModels(await window.electronAPI.ai.removeLocalModel(item.id));
                                  await refreshAiStatus();
                                });
                              }}
                            >
                              {t('aiSummary.remove')}
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            disabled={busy}
                            aria-label={t('aiSummary.downloadModel', { model: item.name })}
                            onClick={() => {
                              void window.electronAPI.ai.installLocalModel(item.id).then(
                                (result) => {
                                  if (!result.ok) setNotice(t('aiSummary.settingsError'));
                                },
                                () => {
                                  setNotice(t('aiSummary.settingsError'));
                                },
                              );
                            }}
                          >
                            {t('aiSummary.download')}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {(engine === 'local' || engine === 'remote') && (
              <>
                <label data-setting-anchor="app.aiProvider.format" className="block text-sm">
                  {t('aiSummary.format')}
                  <select
                    className={`${SELECT_BOX_CLASS} mt-1 w-full`}
                    aria-label={t('aiSummary.format')}
                    value={format}
                    onChange={(event) => {
                      setFormat(event.target.value as AiWireFormat);
                    }}
                  >
                    <option value="openai">OpenAI-compatible</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Gemini</option>
                    <option value="ollama">Ollama</option>
                  </select>
                </label>
                <label data-setting-anchor="app.aiProvider.baseUrl" className="block text-sm">
                  {t('aiSummary.baseUrl')}
                  <input
                    className={`${INPUT_BOX_CLASS} mt-1 w-full`}
                    aria-label={t('aiSummary.baseUrl')}
                    type="url"
                    value={baseUrl}
                    placeholder={
                      engine === 'local' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1'
                    }
                    onChange={(event) => {
                      setBaseUrl(event.target.value);
                      setAck(false);
                      setRemoteModels([]);
                    }}
                  />
                </label>
                {engine === 'local' && (
                  <div className="flex flex-wrap gap-2">
                    {[
                      { name: 'Ollama', url: 'http://127.0.0.1:11434', format: 'ollama' as const },
                      {
                        name: 'LM Studio',
                        url: 'http://127.0.0.1:1234/v1',
                        format: 'openai' as const,
                      },
                      {
                        name: 'llama.cpp / vLLM / LocalAI',
                        url: 'http://127.0.0.1:8080/v1',
                        format: 'openai' as const,
                      },
                    ].map((preset) => (
                      <Button
                        key={preset.name}
                        size="sm"
                        aria-label={preset.name}
                        onClick={() => {
                          setBaseUrl(preset.url);
                          setFormat(preset.format);
                          setAck(false);
                        }}
                      >
                        {preset.name}
                      </Button>
                    ))}
                  </div>
                )}
                <label data-setting-anchor="app.aiProvider.model" className="block text-sm">
                  {t('aiSummary.model')}
                  <input
                    className={`${INPUT_BOX_CLASS} mt-1 w-full`}
                    aria-label={t('aiSummary.model')}
                    value={model}
                    list="ai-endpoint-models"
                    onChange={(event) => {
                      setModel(event.target.value);
                    }}
                  />
                  <datalist id="ai-endpoint-models">
                    {remoteModels.map((id) => (
                      <option key={id} value={id} />
                    ))}
                  </datalist>
                </label>
                <label data-setting-anchor="app.aiProvider.apiKey" className="block text-sm">
                  {t('aiSummary.apiKey')}
                  <input
                    className={`${INPUT_BOX_CLASS} mt-1 w-full`}
                    aria-label={t('aiSummary.apiKey')}
                    type="password"
                    autoComplete="off"
                    value={apiKey ?? ''}
                    placeholder={status.hasApiKey ? t('aiSummary.keySaved') : ''}
                    onChange={(event) => {
                      setApiKey(event.target.value);
                    }}
                  />
                </label>
                {status.hasApiKey && (
                  <Button
                    size="sm"
                    aria-label={t('aiSummary.clearKey')}
                    onClick={() => {
                      setApiKey('');
                    }}
                  >
                    {t('aiSummary.clearKey')}
                  </Button>
                )}
                {engine === 'remote' && (
                  <label
                    data-setting-anchor="app.aiProvider.allowRemote"
                    className="flex items-start gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className={CHECKBOX_CLASS}
                      aria-label={t('aiSummary.allowRemote')}
                      checked={ack}
                      onChange={(event) => {
                        setAck(event.target.checked);
                      }}
                    />
                    {t('aiSummary.allowRemote')}
                  </label>
                )}
                <p className="text-muted text-xs">{t('aiSummary.urlHint')}</p>
              </>
            )}
            <div data-setting-anchor="app.aiProvider.test" className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || !engine || (engine === 'remote' && !ack)}
                aria-label={t('aiSummary.save')}
                onClick={() => {
                  void action(save);
                }}
              >
                {t('aiSummary.save')}
              </Button>
              <Button
                size="sm"
                disabled={busy || !status.engine}
                aria-label={t('aiSummary.test')}
                onClick={() => {
                  void action(async () => {
                    const result = await window.electronAPI.ai.testConfig();
                    setNotice(t(result.ok ? 'aiSummary.testOk' : 'aiSummary.settingsError'));
                  });
                }}
              >
                {t('aiSummary.test')}
              </Button>
              {(engine === 'local' || engine === 'remote') && (
                <Button
                  size="sm"
                  disabled={busy}
                  aria-label={t('aiSummary.refreshModels')}
                  onClick={() => {
                    void action(async () => {
                      await save();
                      setRemoteModels(await window.electronAPI.ai.listEndpointModels());
                    });
                  }}
                >
                  {t('aiSummary.refreshModels')}
                </Button>
              )}
            </div>
          </div>
        )}
        <p
          data-setting-anchor="app.aiProvider.status"
          role="status"
          className="text-muted mt-2 text-xs"
        >
          {notice}
        </p>
      </div>
    </details>
  );
}
