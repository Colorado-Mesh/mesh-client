import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { NomadNodeRow } from '@/shared/nomad-types';

import { useNomadNetworkStore } from '../stores/nomadNetworkStore';

type NomadListTab = 'favourites' | 'announces';

function formatNomadHash(hash: string): string {
  if (hash.length <= 16) return `<${hash}>`;
  return `<${hash.slice(0, 8)}…${hash.slice(-8)}>`;
}

function matchesSearch(node: NomadNodeRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = (node.display_name ?? '').toLowerCase();
  const hash = node.destination_hash.toLowerCase();
  return name.includes(q) || hash.includes(q);
}

export default function NomadNetworkPanel() {
  const { t } = useTranslation();
  const nodes = useNomadNetworkStore((s) => s.nodes);
  const nomadApiAvailable = useNomadNetworkStore((s) => s.nomadApiAvailable);
  const refreshFromSidecar = useNomadNetworkStore((s) => s.refreshFromSidecar);
  const toggleFavorite = useNomadNetworkStore((s) => s.toggleFavorite);

  const [activeTab, setActiveTab] = useState<NomadListTab>('favourites');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidecarRunning, setSidecarRunning] = useState(false);

  useEffect(() => {
    void isReticulumSidecarRunning().then((running) => {
      setSidecarRunning(running);
      if (running) void refreshFromSidecar();
    });
  }, [refreshFromSidecar]);

  const allRows = useMemo(() => [...nodes.values()], [nodes]);

  const tabRows = useMemo(() => {
    if (activeTab === 'favourites') {
      return allRows.filter((node) => node.favorited);
    }
    return allRows;
  }, [activeTab, allRows]);

  const filteredRows = useMemo(
    () => tabRows.filter((node) => matchesSearch(node, searchQuery)),
    [tabRows, searchQuery],
  );

  const favouritesCount = useMemo(() => allRows.filter((node) => node.favorited).length, [allRows]);

  const searchPlaceholder =
    activeTab === 'favourites'
      ? t('nomadNetwork.searchFavourites', { count: favouritesCount })
      : t('nomadNetwork.searchAnnounces', { count: allRows.length });

  const emptyKey =
    activeTab === 'favourites' ? 'nomadNetwork.emptyFavourites' : 'nomadNetwork.emptyAnnounces';

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-gray-100">{t('nomadNetwork.title')}</h2>
        <button
          type="button"
          className="text-xs text-amber-400 hover:underline"
          onClick={() => {
            void refreshFromSidecar();
          }}
        >
          {t('common.refresh')}
        </button>
      </div>

      {!sidecarRunning ? (
        <p className="rounded-lg border border-amber-600/40 bg-amber-950/20 p-3 text-sm text-amber-200">
          {t('connectionPanel.reticulumIdentity.startStackFirst')}
        </p>
      ) : null}

      {sidecarRunning && !nomadApiAvailable ? (
        <p className="rounded-lg border border-amber-600/40 bg-amber-950/20 p-3 text-sm text-amber-200">
          {t('nomadNetwork.unavailable')}
        </p>
      ) : null}

      <div className="mb-3 flex gap-4 border-b border-gray-700 text-sm">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'favourites'}
          className={`border-b-2 pb-2 ${
            activeTab === 'favourites'
              ? 'border-bright-green text-bright-green'
              : 'text-muted border-transparent'
          }`}
          onClick={() => {
            setActiveTab('favourites');
          }}
        >
          {t('nomadNetwork.favourites')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'announces'}
          className={`border-b-2 pb-2 ${
            activeTab === 'announces'
              ? 'border-bright-green text-bright-green'
              : 'text-muted border-transparent'
          }`}
          onClick={() => {
            setActiveTab('announces');
          }}
        >
          {t('nomadNetwork.announces')}
        </button>
      </div>

      <input
        type="search"
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
        }}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        className="mb-3 w-full rounded border border-gray-600 bg-slate-900 px-3 py-2 text-sm text-gray-200"
      />

      {filteredRows.length === 0 ? (
        <p className="text-muted text-sm">{t(emptyKey)}</p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto text-sm">
          {filteredRows.map((node) => (
            <li
              key={node.destination_hash}
              className="flex items-center justify-between gap-2 rounded border border-gray-700/60 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-gray-100">
                  {node.display_name ?? node.destination_hash.slice(0, 16)}
                </div>
                <div className="text-muted truncate font-mono text-xs">
                  {formatNomadHash(node.destination_hash)}
                </div>
              </div>
              <button
                type="button"
                className={node.favorited ? 'text-yellow-400' : 'text-gray-500'}
                aria-label={t('nomadNetwork.toggleFavorite')}
                onClick={() => {
                  void toggleFavorite(node.destination_hash, !node.favorited);
                }}
              >
                ★
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
