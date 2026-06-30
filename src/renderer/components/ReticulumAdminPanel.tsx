/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useRadioProvider } from '@/renderer/lib/radio/providerFactory';
import { useReticulumSidecarApi } from '@/renderer/lib/reticulum/useReticulumSidecarApi';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

import { ConfirmModal } from './ConfirmModal';
import { RNodeFlasherSection } from './flasher/RNodeFlasherSection';
import { useToast } from './Toast';

interface ReticulumInterfaceRow {
  id: string;
  type: string;
  enabled: boolean;
}

export interface ReticulumAdminPanelProps {
  connecting: boolean;
  onStartStack: () => Promise<void>;
  onSidecarEvent?: (evt: ReticulumSidecarEvent) => void;
}

/** Administration tab: RNode flasher and stack factory reset (danger zone). */
export function ReticulumAdminPanel({
  connecting,
  onStartStack,
  onSidecarEvent,
}: ReticulumAdminPanelProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const capabilities = useRadioProvider('reticulum');
  const { sidecarApiReady, refreshIdentity } = useReticulumSidecarApi({
    connecting,
    onStartStack,
    onEvent: onSidecarEvent,
  });

  const [interfaces, setInterfaces] = useState<ReticulumInterfaceRow[]>([]);
  const [showFactoryResetConfirm, setShowFactoryResetConfirm] = useState(false);
  const [resetInFlight, setResetInFlight] = useState(false);

  const refreshInterfaces = useCallback(async () => {
    if (!sidecarApiReady) return;
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/interfaces')) as {
        interfaces?: ReticulumInterfaceRow[];
      };
      setInterfaces(body.interfaces ?? []);
    } catch (e) {
      console.debug('[ReticulumAdminPanel] interfaces ' + errLikeToLogString(e));
    }
  }, [sidecarApiReady]);

  useEffect(() => {
    if (!sidecarApiReady) {
      setInterfaces([]);
      return;
    }
    void refreshInterfaces();
  }, [sidecarApiReady, refreshInterfaces]);

  const rnodeInterfaceActive =
    sidecarApiReady &&
    interfaces.some((iface) => iface.enabled && iface.type.toLowerCase().includes('rnode'));
  const flasherPortBlocked = rnodeInterfaceActive;

  const handleFactoryReset = async () => {
    setResetInFlight(true);
    try {
      await window.electronAPI.reticulum.proxyPost('/api/v1/system/factory-reset', {});
      setShowFactoryResetConfirm(false);
      await refreshIdentity();
      await refreshInterfaces();
      addToast(
        t('radioPanel.actionCompleted', { name: t('radioPanel.reticulumFactoryReset.title') }),
        'success',
      );
    } catch (e) {
      addToast(t('radioPanel.actionFailed', { message: errLikeToLogString(e) }), 'error');
      console.warn('[ReticulumAdminPanel] factory reset ' + errLikeToLogString(e));
    } finally {
      setResetInFlight(false);
    }
  };

  return (
    <div className="w-full space-y-4">
      <h2 className="text-xl font-semibold text-red-400">{t('tabs.admin')}</h2>

      {!sidecarApiReady ? (
        <div className="rounded-lg border border-yellow-700 bg-yellow-900/30 px-4 py-2 text-sm text-yellow-300">
          {t('connectionPanel.reticulumIdentity.startStackFirst')}
        </div>
      ) : null}

      {capabilities.hasRNodeFlasher ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-orange-400">{t('flasher.title')}</h3>
          <div className="space-y-2 rounded-lg border border-orange-900 p-4">
            <RNodeFlasherSection portBlocked={flasherPortBlocked} />
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-red-400">{t('radioPanel.dangerZone')}</h3>
        <div className="space-y-2 rounded-lg border border-red-900 p-4">
          <p className="text-xs text-red-400/80">{t('radioPanel.reticulumFactoryReset.hint')}</p>
          <p className="text-xs text-red-400/80">{t('radioPanel.dangerZonePermanent')}</p>
          <button
            type="button"
            disabled={!sidecarApiReady || resetInFlight}
            onClick={() => {
              setShowFactoryResetConfirm(true);
            }}
            className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70 disabled:opacity-50"
          >
            {t('radioPanel.reticulumFactoryReset.button')}
          </button>
        </div>
      </div>

      {showFactoryResetConfirm ? (
        <ConfirmModal
          title={t('radioPanel.reticulumFactoryReset.confirmTitle')}
          message={t('radioPanel.reticulumFactoryReset.confirmBody')}
          confirmLabel={t('radioPanel.reticulumFactoryReset.confirm')}
          confirmDisabled={resetInFlight}
          onConfirm={() => {
            void handleFactoryReset();
          }}
          onCancel={() => {
            if (resetInFlight) return;
            setShowFactoryResetConfirm(false);
          }}
        />
      ) : null}
    </div>
  );
}

export default ReticulumAdminPanel;
