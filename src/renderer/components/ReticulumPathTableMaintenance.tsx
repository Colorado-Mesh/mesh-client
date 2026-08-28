import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { clearReticulumPathTable } from '@/renderer/lib/reticulum/reticulumClearPathTable';

import { ConfirmModal } from './ConfirmModal';
import { useToast } from './Toast';

interface ReticulumPathTableMaintenanceProps {
  disabled?: boolean;
}

/** Maintenance action that wipes the local RNS path table (confirm + toast). */
export function ReticulumPathTableMaintenance({
  disabled = false,
}: Readonly<ReticulumPathTableMaintenanceProps>) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  return (
    <>
      <div className="mt-3 rounded border border-slate-700/70 bg-slate-900/40 p-3">
        <h4 className="text-sm font-medium text-gray-300">
          {t('networkPanel.reticulumPathTable.title')}
        </h4>
        <p className="text-muted mt-1 text-xs">
          {t('networkPanel.reticulumPathTable.description')}
        </p>
        <button
          type="button"
          disabled={disabled || clearing}
          className="mt-3 rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-slate-700 disabled:opacity-40"
          aria-label={t('networkPanel.reticulumPathTable.clearAria')}
          onClick={() => {
            setPendingConfirm(true);
          }}
        >
          {clearing
            ? t('networkPanel.reticulumPathTable.clearing')
            : t('networkPanel.reticulumPathTable.clear')}
        </button>
      </div>
      {pendingConfirm ? (
        <ConfirmModal
          title={t('networkPanel.reticulumPathTable.confirmTitle')}
          message={t('networkPanel.reticulumPathTable.confirmBody')}
          confirmLabel={t('networkPanel.reticulumPathTable.confirmAction')}
          danger
          onConfirm={() => {
            setPendingConfirm(false);
            setClearing(true);
            void (async () => {
              try {
                console.debug('[ReticulumPathTableMaintenance] clearPathTable');
                const cleared = await clearReticulumPathTable();
                addToast(
                  t('networkPanel.reticulumPathTable.clearOk', { count: cleared }),
                  'success',
                );
              } catch (err) {
                console.warn(
                  '[ReticulumPathTableMaintenance] clear failed ' + errLikeToLogString(err),
                );
                addToast(t('networkPanel.reticulumPathTable.clearFailed'), 'error');
              } finally {
                setClearing(false);
              }
            })();
          }}
          onCancel={() => {
            setPendingConfirm(false);
          }}
        />
      ) : null}
    </>
  );
}
