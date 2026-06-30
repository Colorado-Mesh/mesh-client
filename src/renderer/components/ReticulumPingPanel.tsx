import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

export default function ReticulumPingPanel() {
  const { t } = useTranslation();
  const [hash, setHash] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runPing = async () => {
    const trimmed = hash.trim();
    if (!trimmed) return;
    setBusy(true);
    setResult(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/ping', {
        destination_hash: trimmed,
      })) as { ok?: boolean; rtt_ms?: number; error?: string };
      if (res.ok && res.rtt_ms != null) {
        setResult(t('reticulumPing.result', { ms: res.rtt_ms }));
      } else {
        setResult(t('reticulumPing.failed', { error: res.error ?? t('common.error') }));
      }
    } catch (e) {
      console.warn('[ReticulumPingPanel] ping ' + errLikeToLogString(e));
      setResult(t('reticulumPing.failed', { error: errLikeToLogString(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-deep-black rounded-lg border border-gray-700 p-4">
      <h3 className="text-sm font-medium text-gray-200">{t('reticulumPing.title')}</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          type="text"
          value={hash}
          onChange={(e) => {
            setHash(e.target.value);
          }}
          placeholder={t('reticulumPing.hashPlaceholder')}
          aria-label={t('reticulumPing.hashAria')}
          className="bg-deep-black min-w-0 flex-1 rounded border border-gray-600 px-2 py-1 text-sm text-gray-200"
        />
        <button
          type="button"
          disabled={busy || !hash.trim()}
          className="rounded border border-amber-600 px-3 py-1 text-sm text-amber-300 disabled:opacity-40"
          onClick={() => {
            void runPing();
          }}
        >
          {t('reticulumPing.run')}
        </button>
      </div>
      {result ? <p className="mt-2 text-xs text-gray-300">{result}</p> : null}
    </div>
  );
}
