import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useNomadNetworkStore } from '@/renderer/stores/nomadNetworkStore';

export default function NomadNetworkPanel() {
  const { t } = useTranslation();
  const nodes = useNomadNetworkStore((s) => s.nodes);
  const refreshFromSidecar = useNomadNetworkStore((s) => s.refreshFromSidecar);
  const toggleFavorite = useNomadNetworkStore((s) => s.toggleFavorite);

  useEffect(() => {
    void refreshFromSidecar();
  }, [refreshFromSidecar]);

  const rows = [...nodes.values()];

  return (
    <div className="bg-deep-black rounded-lg border border-gray-700 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-200">{t('nomadNetwork.title')}</h3>
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
      {rows.length === 0 ? (
        <p className="text-muted mt-2 text-xs">{t('nomadNetwork.empty')}</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {rows.map((node) => (
            <li
              key={node.destination_hash}
              className="flex items-center justify-between rounded border border-gray-700/60 px-2 py-1.5"
            >
              <span>{node.display_name ?? node.destination_hash.slice(0, 12)}</span>
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
