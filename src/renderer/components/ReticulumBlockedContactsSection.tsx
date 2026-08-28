import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useBlockStore } from '@/renderer/stores/blockStore';

import { useToast } from './Toast';

interface ReticulumBlockedContactsSectionProps {
  /** Reticulum identity whose blocklist is shown; the section hides when absent. */
  identityId: string | null;
}

/** Blocked-contacts list plus bulk import / export of the LXMF blocklist. */
export function ReticulumBlockedContactsSection({
  identityId,
}: Readonly<ReticulumBlockedContactsSectionProps>) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const blockedEntries = useBlockStore((s) => s.blockedEntries);
  const unblock = useBlockStore((s) => s.unblock);

  if (!identityId) return null;

  const handleExport = async () => {
    try {
      console.debug('[ReticulumBlockedContacts] export');
      const hashes = await window.electronAPI.db.exportBlockedContacts('reticulum', identityId);
      if (hashes.length === 0) {
        addToast(t('appPanel.reticulumBlocklist.exportEmpty'), 'error');
        return;
      }
      const result = await window.electronAPI.reticulum.saveBlocklistDialog(hashes);
      if (result.error) {
        addToast(t('appPanel.reticulumBlocklist.exportFailed'), 'error');
        return;
      }
      if (result.path) {
        addToast(t('appPanel.reticulumBlocklist.exportOk', { count: hashes.length }), 'success');
      }
    } catch (err) {
      console.warn('[ReticulumBlockedContacts] export failed ' + errLikeToLogString(err));
      addToast(t('appPanel.reticulumBlocklist.exportFailed'), 'error');
    }
  };

  const handleImport = async () => {
    try {
      console.debug('[ReticulumBlockedContacts] import');
      const file = await window.electronAPI.reticulum.openBlocklistDialog();
      if (file.error) {
        addToast(t('appPanel.reticulumBlocklist.importFailed'), 'error');
        return;
      }
      if (!file.hashes) return; // cancelled
      const result = await window.electronAPI.db.importBlockedContacts(
        'reticulum',
        identityId,
        file.hashes,
      );
      // Refresh so the inbound LXMF filter picks up the new entries.
      await useBlockStore.getState().load('reticulum', identityId);
      addToast(
        t('appPanel.reticulumBlocklist.importOk', {
          imported: result.imported,
          skipped: result.skipped + file.skipped,
        }),
        'success',
      );
    } catch (err) {
      console.warn('[ReticulumBlockedContacts] import failed ' + errLikeToLogString(err));
      addToast(t('appPanel.reticulumBlocklist.importFailed'), 'error');
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-muted text-sm font-medium">{t('appPanel.reticulumBlocklist.title')}</h3>
      <p className="text-muted text-xs">{t('appPanel.reticulumBlocklist.description')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-label={t('appPanel.reticulumBlocklist.exportAria')}
          onClick={() => {
            void handleExport();
          }}
          className="bg-secondary-dark rounded-lg px-4 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
        >
          {t('appPanel.reticulumBlocklist.exportButton')}
        </button>
        <button
          type="button"
          aria-label={t('appPanel.reticulumBlocklist.importAria')}
          onClick={() => {
            void handleImport();
          }}
          className="bg-secondary-dark rounded-lg px-4 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
        >
          {t('appPanel.reticulumBlocklist.importButton')}
        </button>
      </div>
      {blockedEntries.length === 0 ? (
        <p className="text-muted text-xs italic">{t('appPanel.reticulumBlocklist.empty')}</p>
      ) : (
        <ul className="space-y-1">
          {blockedEntries.map((entry) => (
            <li
              key={entry.hash}
              className="flex items-center justify-between gap-2 rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1"
            >
              <span className="font-mono text-xs text-gray-300">{entry.hash}</span>
              <span className="text-muted shrink-0 text-xs">
                {new Date(entry.createdAt).toLocaleDateString()}
              </span>
              <button
                type="button"
                aria-label={t('appPanel.reticulumBlocklist.unblockAria', { hash: entry.hash })}
                onClick={() => {
                  void (async () => {
                    try {
                      await unblock('reticulum', identityId, entry.hash);
                    } catch (err) {
                      console.warn(
                        '[ReticulumBlockedContacts] unblock failed ' + errLikeToLogString(err),
                      );
                      addToast(t('appPanel.reticulumBlocklist.unblockFailed'), 'error');
                    }
                  })();
                }}
                className="shrink-0 rounded border border-slate-600 px-2 py-0.5 text-xs text-gray-300 hover:bg-slate-700"
              >
                {t('peerDetailModal.unblockContact')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
