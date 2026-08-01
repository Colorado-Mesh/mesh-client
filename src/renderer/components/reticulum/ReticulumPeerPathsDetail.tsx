/* eslint-disable react-hooks/set-state-in-effect -- load path slots when destination changes */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  fetchReticulumPeerPaths,
  peerMediumPinApiFromChoice,
  type PeerMediumPinChoice,
  peerMediumPinChoiceFromApi,
  type ReticulumPeerPathsResult,
  setReticulumPeerMediumPin,
} from '@/renderer/lib/reticulum/reticulumPathMedium';

/** Map wire preference tokens to Network-tab path-medium labels (avoid raw API enums in UI). */
export function pathMediumPreferenceLabelKey(
  preference: string,
):
  | 'networkPanel.reticulumStackSettings.pathMediumLowest'
  | 'networkPanel.reticulumStackSettings.pathMediumNetwork'
  | 'networkPanel.reticulumStackSettings.pathMediumRf'
  | null {
  switch (preference.trim().toLowerCase()) {
    case 'lowest':
      return 'networkPanel.reticulumStackSettings.pathMediumLowest';
    case 'network':
      return 'networkPanel.reticulumStackSettings.pathMediumNetwork';
    case 'rf':
      return 'networkPanel.reticulumStackSettings.pathMediumRf';
    default:
      return null;
  }
}

export interface ReticulumPeerPathsDetailProps {
  destinationHash: string;
  onClose: () => void;
}

export function ReticulumPeerPathsDetail({
  destinationHash,
  onClose,
}: ReticulumPeerPathsDetailProps) {
  const { t } = useTranslation();
  const [result, setResult] = useState<ReticulumPeerPathsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await fetchReticulumPeerPaths(destinationHash);
      setResult(next);
      if (!next.ok) {
        setError(next.error ?? t('peerListPanel.pathsLoadFailed'));
      }
    } catch (e) {
      console.warn('[ReticulumPeerPathsDetail] load ' + errLikeToLogString(e));
      setError(t('peerListPanel.pathsLoadFailed'));
    } finally {
      setBusy(false);
    }
  }, [destinationHash, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pinChoice = peerMediumPinChoiceFromApi(result?.pin);
  const preferenceLabelKey = result?.preference
    ? pathMediumPreferenceLabelKey(result.preference)
    : null;

  const onPinChange = async (choice: PeerMediumPinChoice) => {
    const previous = result;
    setPinBusy(true);
    setError(null);
    // Optimistic pin state for snappy UI; refresh restores truth.
    setResult((cur) =>
      cur
        ? {
            ...cur,
            pin: peerMediumPinApiFromChoice(choice),
          }
        : cur,
    );
    try {
      const res = await setReticulumPeerMediumPin(
        destinationHash,
        peerMediumPinApiFromChoice(choice),
      );
      if (!res.ok) {
        setResult(previous);
        setError(res.error ?? t('peerListPanel.pathsPinFailed'));
        return;
      }
      await refresh();
    } catch (e) {
      setResult(previous);
      console.warn('[ReticulumPeerPathsDetail] pin ' + errLikeToLogString(e));
      setError(t('peerListPanel.pathsPinFailed'));
    } finally {
      setPinBusy(false);
    }
  };

  return (
    <section
      className="rounded-lg border border-gray-700 bg-slate-950/80 p-3 text-sm text-gray-200"
      aria-label={t('peerListPanel.pathsDetailAria', {
        hash: destinationHash.slice(0, 12),
      })}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-xs text-gray-300">
          {t('peerListPanel.pathsHeading', { hash: destinationHash.slice(0, 12) })}
        </h3>
        <button
          type="button"
          className="text-xs text-amber-400 hover:underline"
          onClick={onClose}
          aria-label={t('peerListPanel.pathsCloseAria')}
        >
          {t('common.close')}
        </button>
      </div>

      <label className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-400">
        <span>{t('peerListPanel.pathsPreferLabel')}</span>
        <select
          value={pinChoice}
          disabled={pinBusy || busy || !result?.ok}
          onChange={(e) => {
            void onPinChange(e.target.value as PeerMediumPinChoice);
          }}
          aria-label={t('peerListPanel.pathsPreferAria')}
          className="rounded border border-gray-600 bg-slate-900 px-2 py-1 text-gray-100"
        >
          <option value="auto">{t('peerListPanel.pathsPreferAuto')}</option>
          <option value="rf">{t('peerListPanel.pathsPreferRf')}</option>
          <option value="network">{t('peerListPanel.pathsPreferNetwork')}</option>
        </select>
        {preferenceLabelKey ? (
          <span className="text-[11px] text-gray-500">
            {t('peerListPanel.pathsGlobalPreference', {
              preference: t(preferenceLabelKey),
            })}
          </span>
        ) : null}
      </label>

      {error ? <p className="mb-2 text-xs text-red-400">{error}</p> : null}
      {busy && !result ? <p className="text-xs text-gray-500">{t('common.loading')}</p> : null}

      {result?.ok && result.paths.length === 0 ? (
        <p className="text-xs text-gray-500">{t('peerListPanel.pathsEmpty')}</p>
      ) : null}

      {result?.ok && result.paths.length > 0 ? (
        <ul className="space-y-1.5" aria-label={t('peerListPanel.pathsListAria')}>
          {result.paths.map((slot, index) => (
            <li
              key={`${slot.interface_id ?? 'x'}-${slot.via_hash ?? index}-${slot.hops ?? 'h'}`}
              className={
                slot.active
                  ? 'border-readable-green/40 bg-readable-green/10 rounded border px-2 py-1.5'
                  : 'rounded border border-gray-800 px-2 py-1.5'
              }
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-medium text-gray-100">
                  {slot.active
                    ? t('peerListPanel.pathsActiveBadge')
                    : t('peerListPanel.pathsBackupBadge')}
                </span>
                <span>
                  {t('connectionPanel.reticulumPeers.hops')}: {slot.hops ?? '—'}
                </span>
                <span>
                  {t('peerListPanel.colInterface')}: {slot.interface ?? '—'}
                </span>
                <span>
                  {t('peerListPanel.pathsMedium')}:{' '}
                  {slot.medium === 'rf'
                    ? t('peerListPanel.pathsPreferRf')
                    : slot.medium === 'network'
                      ? t('peerListPanel.pathsPreferNetwork')
                      : '—'}
                </span>
                {slot.expired ? (
                  <span className="text-amber-400">{t('peerListPanel.pathsExpired')}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
