import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  buildReticulumSharedInstanceClientSnippet,
  parseReticulumSharedInstanceClientSettings,
} from '@/renderer/lib/reticulum/reticulumInstanceStatus';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';

import { ReticulumSystemRnsExplainer } from './ReticulumSystemRnsExplainer';

type SnippetState =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'notHosting' }
  | { kind: 'ready'; snippet: string };

export interface ReticulumShareForOtherAppsProps {
  sidecarApiReady: boolean;
}

/** Reverse direction for issue #1181: other Reticulum apps attach to mesh-client's shared instance. */
export function ReticulumShareForOtherApps({ sidecarApiReady }: ReticulumShareForOtherAppsProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<SnippetState>({ kind: 'hidden' });
  const [copied, setCopied] = useState(false);
  const shown = state.kind !== 'hidden';

  const load = async () => {
    setState({ kind: 'loading' });
    setCopied(false);
    try {
      const settings = parseReticulumSharedInstanceClientSettings(
        await window.electronAPI.reticulum.proxyGet('/api/v1/stack/shared-instance'),
      );
      if (!settings) {
        setState({ kind: 'failed' });
      } else if (!settings.hosting) {
        setState({ kind: 'notHosting' });
      } else {
        setState({ kind: 'ready', snippet: buildReticulumSharedInstanceClientSnippet(settings) });
      }
    } catch (e) {
      console.warn('[ReticulumShareForOtherApps] load ' + errLikeToLogString(e));
      setState({ kind: 'failed' });
    }
  };

  const copy = async (snippet: string) => {
    try {
      await writeClipboardText(snippet);
      setCopied(true);
    } catch (e) {
      console.warn('[ReticulumShareForOtherApps] copy ' + errLikeToLogString(e));
    }
  };

  return (
    <div className="border-ink-700 space-y-2 rounded-lg border p-3">
      <p className="text-ink-200 text-sm font-medium">{t('reticulum.systemRns.shareTitle')}</p>
      <ReticulumSystemRnsExplainer />
      <button
        type="button"
        disabled={!sidecarApiReady || state.kind === 'loading'}
        aria-expanded={shown}
        aria-label={
          shown ? t('reticulum.systemRns.shareHideAria') : t('reticulum.systemRns.shareShowAria')
        }
        onClick={() => {
          if (shown) {
            setState({ kind: 'hidden' });
            setCopied(false);
          } else {
            void load();
          }
        }}
        className="border-ink-600 text-ink-200 hover:bg-ink-700 rounded border px-2.5 py-1 text-xs disabled:opacity-50"
      >
        {shown ? t('reticulum.systemRns.shareHide') : t('reticulum.systemRns.shareShow')}
      </button>
      {state.kind === 'failed' ? (
        <p role="status" className="text-xs text-red-300">
          {t('reticulum.systemRns.shareLoadFailed')}
        </p>
      ) : null}
      {state.kind === 'notHosting' ? (
        <p role="status" className="text-xs text-orange-200">
          {t('reticulum.systemRns.shareNotHosting')}
        </p>
      ) : null}
      {state.kind === 'ready' ? (
        <div className="space-y-2">
          <p className="text-muted text-label">{t('reticulum.systemRns.shareSnippetHint')}</p>
          <pre
            aria-label={t('reticulum.systemRns.snippetAria')}
            className="bg-deep-black text-ink-200 overflow-x-auto rounded p-2 font-mono text-xs select-all"
          >
            {state.snippet}
          </pre>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={t('reticulum.systemRns.copySnippetAria')}
              onClick={() => {
                void copy(state.snippet);
              }}
              className="border-ink-600 text-ink-200 hover:bg-ink-700 rounded border px-2.5 py-1 text-xs"
            >
              {t('reticulum.systemRns.copySnippet')}
            </button>
            {copied ? (
              <span role="status" className="text-xs text-green-400">
                {t('reticulum.systemRns.snippetCopied')}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
