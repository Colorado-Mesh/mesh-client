import { useCallback, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '../lib/errLikeToLogString';
import {
  getMeshcomCallsignWatchlist,
  MESHCOM_CALLSIGN_WATCHLIST_MAX,
  meshcomWatchlistBaseCall,
  saveMeshcomCallsignWatchlist,
  subscribeMeshcomCallsignWatchlist,
} from '../lib/meshcom/meshcomCallsignWatchlist';
import { buttonClassName } from './ui/Button';
import { INPUT_BOX_CLASS } from './ui/formClasses';

/** App → Notifications: alert when listed MeshCom base callsigns are heard. */
export function MeshComCallsignWatchlistSettings() {
  const { t } = useTranslation();
  const list = useSyncExternalStore(
    subscribeMeshcomCallsignWatchlist,
    getMeshcomCallsignWatchlist,
    getMeshcomCallsignWatchlist,
  );
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const persist = useCallback(
    async (next: string[]) => {
      setBusy(true);
      setError('');
      try {
        await saveMeshcomCallsignWatchlist(next);
      } catch (e) {
        console.warn('[MeshComCallsignWatchlist] save failed ' + errLikeToLogString(e));
        setError(t('meshcomWatchlist.saveFailed'));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  return (
    <div className="space-y-2">
      <label htmlFor="meshcomWatchlistAdd" className="text-ink-300 block text-sm">
        {t('meshcomWatchlist.label')}
      </label>
      <p id="meshcomWatchlistHelp" className="text-muted text-xs leading-relaxed">
        {t('meshcomWatchlist.help', { max: MESHCOM_CALLSIGN_WATCHLIST_MAX })}
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          id="meshcomWatchlistAdd"
          type="text"
          autoComplete="off"
          spellCheck={false}
          disabled={busy || list.length >= MESHCOM_CALLSIGN_WATCHLIST_MAX}
          aria-label={t('meshcomWatchlist.addAria')}
          aria-describedby="meshcomWatchlistHelp"
          placeholder={t('meshcomWatchlist.placeholder')}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const base = meshcomWatchlistBaseCall(draft);
            if (!base) return;
            setDraft('');
            void persist([...list, base]);
          }}
          className={`${INPUT_BOX_CLASS} min-w-[10rem] flex-1`}
        />
        <button
          type="button"
          disabled={
            busy ||
            !meshcomWatchlistBaseCall(draft) ||
            list.length >= MESHCOM_CALLSIGN_WATCHLIST_MAX
          }
          aria-label={t('meshcomWatchlist.addAria')}
          className={buttonClassName('secondary', 'sm')}
          onClick={() => {
            const base = meshcomWatchlistBaseCall(draft);
            if (!base) return;
            setDraft('');
            void persist([...list, base]);
          }}
        >
          {t('meshcomWatchlist.add')}
        </button>
      </div>
      {list.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('meshcomWatchlist.listAria')}>
          {list.map((call) => (
            <li
              key={call}
              className="border-ink-600 bg-ink-900/60 text-ink-100 rounded-control inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-xs"
            >
              <span>{call}</span>
              <button
                type="button"
                disabled={busy}
                aria-label={t('meshcomWatchlist.removeAria', { callsign: call })}
                className="text-muted hover:text-red-400"
                onClick={() => {
                  void persist(list.filter((c) => c !== call));
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted text-xs">{t('meshcomWatchlist.empty')}</p>
      )}
      {error ? (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
