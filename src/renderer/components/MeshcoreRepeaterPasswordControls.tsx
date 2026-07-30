import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  forgetMeshcoreRepeaterSavedSecret,
  getMeshcoreRepeaterSavedSecretsSummary,
} from '@/renderer/lib/meshcoreRepeaterSavedSecrets';

export interface MeshcoreRepeaterPasswordControlsProps {
  nodeId: number;
  nodeName: string;
  secretsEpoch: number;
  onPromptPassword: (
    nodeId: number,
    repeaterName: string,
  ) => Promise<{ ok: boolean; saved?: boolean }>;
  onSecretsChanged: () => void;
  onStatusMessage: (message: string | null) => void;
}

export function MeshcoreRepeaterPasswordControls({
  nodeId,
  nodeName,
  secretsEpoch,
  onPromptPassword,
  onSecretsChanged,
  onStatusMessage,
}: MeshcoreRepeaterPasswordControlsProps) {
  const { t } = useTranslation();
  void secretsEpoch;
  const summary = getMeshcoreRepeaterSavedSecretsSummary(nodeId);

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-gray-700 bg-gray-950/40 p-3 text-xs">
      {summary.hasCredential ? (
        <p className="flex items-center gap-1.5 text-gray-400">
          <span className="text-sky-400" aria-hidden>
            🔑
          </span>
          {t('repeatersPanel.passwordSavedIndicator')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            void onPromptPassword(nodeId, nodeName)
              .then((auth) => {
                if (auth.ok && auth.saved) {
                  onSecretsChanged();
                  onStatusMessage(t('repeatersPanel.passwordSaved'));
                }
              })
              .catch((e: unknown) => {
                console.warn(
                  '[MeshcoreRepeaterPasswordControls] prompt password ' + errLikeToLogString(e),
                );
              });
          }}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
          aria-label={
            summary.hasCredential
              ? t('repeatersPanel.changePassword')
              : t('repeatersPanel.savePassword')
          }
        >
          {summary.hasCredential
            ? t('repeatersPanel.changePassword')
            : t('repeatersPanel.savePassword')}
        </button>
        {summary.hasCredential ? (
          <button
            type="button"
            onClick={() => {
              void forgetMeshcoreRepeaterSavedSecret(nodeId)
                .then(() => {
                  onSecretsChanged();
                  onStatusMessage(t('repeatersPanel.passwordForgotten'));
                })
                .catch((e: unknown) => {
                  console.warn(
                    '[MeshcoreRepeaterPasswordControls] forget password ' + errLikeToLogString(e),
                  );
                });
            }}
            className="rounded border border-red-900/50 bg-red-950/40 px-2 py-1 text-xs text-red-300 hover:bg-red-900/30"
            aria-label={t('repeatersPanel.forgetPasswordAria')}
          >
            {t('repeatersPanel.forgetPassword')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function MeshcoreRepeaterSavedPasswordIndicator() {
  const { t } = useTranslation();
  return (
    <span
      className="text-sky-400/90"
      title={t('repeatersPanel.passwordSavedIndicator')}
      aria-label={t('repeatersPanel.passwordSavedIndicator')}
    >
      🔑
    </span>
  );
}
