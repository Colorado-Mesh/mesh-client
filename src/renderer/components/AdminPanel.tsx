import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProtocolCapabilities } from '@/renderer/lib/radio/BaseRadioProvider';
import type { ConfigTargetContext } from '@/renderer/lib/types';

import { ConfirmModal } from './ConfirmModal';
import { useToast } from './Toast';

interface PendingAction {
  name: string;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  showPreserveFavorites?: boolean;
  action: () => Promise<void>;
}

// ─── AdminPanel ───────────────────────────────────────────────────────────────

interface Props {
  configTarget?: ConfigTargetContext;
  capabilities?: ProtocolCapabilities;
  isConnected: boolean;
  onReboot: (seconds: number) => Promise<void>;
  onShutdown: (seconds: number) => Promise<void>;
  onFactoryReset: () => Promise<void>;
  onResetNodeDb: (preserveFavorites?: boolean) => Promise<void>;
  onRebootOta?: (delay: number) => Promise<void>;
  onEnterDfu?: () => Promise<void>;
  onFactoryResetConfig?: () => Promise<void>;
}

export default function AdminPanel({
  configTarget,
  capabilities,
  isConnected,
  onReboot,
  onShutdown,
  onFactoryReset,
  onResetNodeDb,
  onRebootOta,
  onEnterDfu,
  onFactoryResetConfig,
}: Props) {
  const { t } = useTranslation();
  const { addToast } = useToast();

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [nodeDbPreserveFavorites, setNodeDbPreserveFavorites] = useState(false);
  const [confirmInFlight, setConfirmInFlight] = useState(false);

  const isRemoteTarget = configTarget?.mode === 'remote';
  const localOnlyCommandsDisabled = !isConnected || isRemoteTarget;

  const executeWithConfirmation = useCallback((action: PendingAction) => {
    setPendingAction(action);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pendingAction || confirmInFlight) return;
    setConfirmInFlight(true);
    try {
      if (pendingAction.showPreserveFavorites) {
        await onResetNodeDb(nodeDbPreserveFavorites);
      } else {
        await pendingAction.action();
      }
      addToast(t('radioPanel.actionCompleted', { name: pendingAction.name }), 'success');
    } catch (err: unknown) {
      // catch-no-log-ok toast handles user feedback
      const message = err instanceof Error ? err.message : pendingAction.name;
      addToast(t('radioPanel.actionFailed', { message }), 'error');
    } finally {
      setConfirmInFlight(false);
      setPendingAction(null);
      setNodeDbPreserveFavorites(false);
    }
  }, [pendingAction, confirmInFlight, nodeDbPreserveFavorites, onResetNodeDb, addToast, t]);

  return (
    <div className="w-full space-y-4">
      <h2 className="text-xl font-semibold text-red-400">{t('tabs.admin')}</h2>

      {!isConnected && (
        <div className="rounded-lg border border-yellow-700 bg-yellow-900/30 px-4 py-2 text-sm text-yellow-300">
          {t('radioPanel.connectToConfigure')}
        </div>
      )}

      {/* ═══ Device Commands ═══ */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-orange-400">{t('radioPanel.deviceCommands')}</h3>
        <div className="space-y-2 rounded-lg border border-orange-900 p-4">
          <p className="text-xs text-orange-400/80">
            {t('radioPanel.deviceCommandsImmediateWarning')}
          </p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {!isRemoteTarget && (
              <button
                type="button"
                onClick={() => {
                  executeWithConfirmation({
                    name: t('radioPanel.enterDfuName'),
                    title: t('radioPanel.enterDfuTitle'),
                    message: t('radioPanel.enterDfuMessage'),
                    confirmLabel: t('radioPanel.enterDfuConfirm'),
                    action: () => onEnterDfu?.() ?? Promise.resolve(),
                  });
                }}
                disabled={localOnlyCommandsDisabled || !onEnterDfu}
                className="rounded-lg border border-orange-800/60 bg-orange-900/30 px-4 py-3 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-900/50 disabled:opacity-50"
              >
                {t('radioPanel.enterDfuButton')}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                executeWithConfirmation({
                  name: t('radioPanel.rebootName'),
                  title: t('radioPanel.rebootTitle'),
                  message: capabilities?.hasCompanionContactManagementConfig
                    ? t('radioPanel.rebootMessageMeshcore')
                    : t('radioPanel.rebootMessageMeshtastic'),
                  confirmLabel: t('radioPanel.rebootConfirm'),
                  action: () => onReboot(2),
                });
              }}
              disabled={!isConnected}
              className="rounded-lg border border-orange-800/60 bg-orange-900/30 px-4 py-3 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-900/50 disabled:opacity-50"
            >
              {t('radioPanel.rebootButton')}
            </button>

            {!isRemoteTarget && (
              <button
                type="button"
                onClick={() => {
                  executeWithConfirmation({
                    name: t('radioPanel.rebootOtaName'),
                    title: t('radioPanel.rebootOtaTitle'),
                    message: t('radioPanel.rebootOtaMessage'),
                    confirmLabel: t('radioPanel.rebootOtaConfirm'),
                    action: () => onRebootOta?.(10) ?? Promise.resolve(),
                  });
                }}
                disabled={localOnlyCommandsDisabled || !onRebootOta}
                className="rounded-lg border border-orange-800/60 bg-orange-900/30 px-4 py-3 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-900/50 disabled:opacity-50"
              >
                {t('radioPanel.rebootOtaButton')}
              </button>
            )}

            {capabilities?.hasNodeDbReset !== false && (
              <button
                type="button"
                onClick={() => {
                  setNodeDbPreserveFavorites(false);
                  executeWithConfirmation({
                    name: t('radioPanel.resetNodeDbName'),
                    title: t('radioPanel.resetNodeDbTitle'),
                    message: t('radioPanel.resetNodeDbMessage'),
                    confirmLabel: t('radioPanel.resetNodeDbConfirm'),
                    showPreserveFavorites: isRemoteTarget,
                    action: () => onResetNodeDb(false),
                  });
                }}
                disabled={!isConnected}
                className="rounded-lg border border-orange-800/60 bg-orange-900/30 px-4 py-3 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-900/50 disabled:opacity-50"
              >
                {t('radioPanel.resetNodeDbButton')}
              </button>
            )}

            {capabilities?.hasShutdown !== false && (
              <button
                type="button"
                onClick={() => {
                  executeWithConfirmation({
                    name: t('radioPanel.shutdownName'),
                    title: t('radioPanel.shutdownTitle'),
                    message: t('radioPanel.shutdownMessage'),
                    confirmLabel: t('radioPanel.shutdownConfirm'),
                    action: () => onShutdown(2),
                  });
                }}
                disabled={!isConnected}
                className="rounded-lg border border-orange-800/60 bg-orange-900/30 px-4 py-3 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-900/50 disabled:opacity-50"
              >
                {t('radioPanel.shutdownButton')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Danger Zone ═══ */}
      {capabilities?.hasFactoryReset !== false && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-red-400">{t('radioPanel.dangerZone')}</h3>
          <div className="space-y-2 rounded-lg border border-red-900 p-4">
            <p className="text-xs text-red-400/80">{t('radioPanel.dangerZonePermanent')}</p>
            {!isRemoteTarget && (
              <button
                type="button"
                onClick={() => {
                  executeWithConfirmation({
                    name: t('radioPanel.factoryResetConfigName'),
                    title: t('radioPanel.factoryResetConfigTitle'),
                    message: t('radioPanel.factoryResetConfigMessage'),
                    confirmLabel: t('radioPanel.factoryResetConfigConfirm'),
                    danger: true,
                    action: () => onFactoryResetConfig?.() ?? Promise.resolve(),
                  });
                }}
                disabled={!isConnected || !onFactoryResetConfig}
                className="w-full rounded-lg border border-red-800/60 bg-red-900/40 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/60 disabled:opacity-50"
              >
                {t('radioPanel.factoryResetConfigButton')}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                executeWithConfirmation({
                  name: t('radioPanel.factoryResetName'),
                  title: t('radioPanel.factoryResetTitle'),
                  message: t('radioPanel.factoryResetMessage'),
                  confirmLabel: t('radioPanel.factoryResetConfirm'),
                  danger: true,
                  action: () => onFactoryReset(),
                });
              }}
              disabled={!isConnected}
              className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70 disabled:opacity-50"
            >
              {t('radioPanel.factoryResetButton')}
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {pendingAction && (
        <ConfirmModal
          title={pendingAction.title}
          message={pendingAction.message}
          confirmLabel={pendingAction.confirmLabel}
          danger={pendingAction.danger}
          preserveFavorites={
            pendingAction.showPreserveFavorites ? nodeDbPreserveFavorites : undefined
          }
          onPreserveFavoritesChange={
            pendingAction.showPreserveFavorites ? setNodeDbPreserveFavorites : undefined
          }
          confirmDisabled={confirmInFlight}
          onConfirm={() => {
            void handleConfirm();
          }}
          onCancel={() => {
            if (confirmInFlight) return;
            setPendingAction(null);
            setNodeDbPreserveFavorites(false);
          }}
        />
      )}
    </div>
  );
}
