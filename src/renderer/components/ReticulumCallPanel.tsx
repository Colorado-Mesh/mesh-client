import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';

export interface ReticulumCallPanelProps {
  embedded?: boolean;
}

export default function ReticulumCallPanel({ embedded = false }: ReticulumCallPanelProps) {
  const { t } = useTranslation();
  const [voiceStatus, setVoiceStatus] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    void isReticulumSidecarRunning().then((running) => {
      if (!running) return;
      void window.electronAPI.reticulum
        .proxyGet('/api/v1/voice/status')
        .then((body) => {
          setVoiceStatus(body as Record<string, unknown>);
        })
        .catch((e: unknown) => {
          console.warn('[ReticulumCallPanel] voice status ' + errLikeToLogString(e));
        });
    });
  }, []);

  const enabled = Boolean(voiceStatus?.enabled);

  const body = (
    <>
      {!embedded ? (
        <h3 className="text-sm font-medium text-gray-200">{t('reticulumCall.title')}</h3>
      ) : null}
      <p className="text-muted mt-2 text-xs">
        {enabled
          ? t('reticulumCall.ready')
          : ((voiceStatus?.reason as string) ?? t('reticulumCall.comingSoon'))}
      </p>
      <button
        type="button"
        disabled={!enabled}
        className="mt-3 rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-400 disabled:opacity-50"
        aria-label={t('reticulumCall.startCall')}
      >
        {t('reticulumCall.startCall')}
      </button>
    </>
  );

  if (embedded) return body;

  return <div className="bg-deep-black rounded-lg border border-gray-700 p-4">{body}</div>;
}
