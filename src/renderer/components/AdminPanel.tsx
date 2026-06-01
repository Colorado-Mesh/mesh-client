import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProtocolCapabilities } from '@/renderer/lib/radio/BaseRadioProvider';
import type { ConfigTargetContext } from '@/renderer/lib/types';

import { useToast } from './Toast';

// ─── Confirmation Modal (same pattern as RadioPanel) ─────────────────────────

interface PendingAction {
  name: string;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  showPreserveFavorites?: boolean;
  action: () => Promise<void>;
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  preserveFavorites,
  onPreserveFavoritesChange,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  preserveFavorites?: boolean;
  onPreserveFavoritesChange?: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label={t('common.cancel')}
        className="absolute inset-0 cursor-pointer border-0 bg-black/60 p-0 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="bg-deep-black relative mx-4 w-full max-w-sm space-y-4 rounded-xl border border-gray-600 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-200">{title}</h3>
        <p className="text-muted text-sm leading-relaxed">{message}</p>
        {onPreserveFavoritesChange != null && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={preserveFavorites ?? false}
              onChange={(e) => {
                onPreserveFavoritesChange(e.target.checked);
              }}
              className="accent-brand-green"
              aria-label={t('radioPanel.resetNodeDbPreserveFavorites')}
            />
            {t('radioPanel.resetNodeDbPreserveFavorites')}
          </label>
        )}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            className="bg-secondary-dark flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors ${
              danger ? 'bg-red-600 hover:bg-red-500' : 'bg-yellow-600 hover:bg-yellow-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
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

  const executeWithConfirmation = useCallback((action: PendingAction) => {
    setPendingAction(action);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pendingAction) return;
    try {
      await pendingAction.action();
      addToast(t('radioPanel.actionCompleted', { name: pendingAction.name }), 'success');
    } catch {
      // catch-no-log-ok toast handles user feedback
      addToast(t('radioPanel.actionFailed', { name: pendingAction.name }), 'error');
    } finally {
      setPendingAction(null);
      setNodeDbPreserveFavorites(false);
    }
  }, [pendingAction, addToast, t]);

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
              disabled={!isConnected || !onEnterDfu}
              className="rounded-lg border border-orange-800/60 bg-orange-900/30 px-4 py-3 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-900/50 disabled:opacity-50"
            >
              {t('radioPanel.enterDfuButton')}
            </button>

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
              disabled={!isConnected || !onRebootOta}
              className="rounded-lg border border-orange-800/60 bg-orange-900/30 px-4 py-3 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-900/50 disabled:opacity-50"
            >
              {t('radioPanel.rebootOtaButton')}
            </button>

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
                    showPreserveFavorites: configTarget?.mode === 'remote',
                    action: () => onResetNodeDb(nodeDbPreserveFavorites),
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
          onConfirm={handleConfirm}
          onCancel={() => {
            setPendingAction(null);
            setNodeDbPreserveFavorites(false);
          }}
        />
      )}
    </div>
  );
}
