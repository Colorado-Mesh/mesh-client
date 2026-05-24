import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';

import type { ConfigTargetContext, MeshNode, RemoteAdminStatus } from '../lib/types';

interface ConfigureNodeSelectorProps {
  nodes: Map<number, MeshNode>;
  myNodeNum: number;
  configureTargetNodeNum: number | null;
  onConfigureTargetChange: (nodeNum: number | null) => void;
  remoteAdminStatus: RemoteAdminStatus;
  remoteAdminError?: string;
  isLocalRadioConnected: boolean;
  getNodeName: (nodeNum: number) => string;
  onRefresh?: () => Promise<void>;
}

export default function ConfigureNodeSelector({
  nodes,
  myNodeNum,
  configureTargetNodeNum,
  onConfigureTargetChange,
  remoteAdminStatus,
  remoteAdminError,
  isLocalRadioConnected,
  getNodeName,
  onRefresh,
}: ConfigureNodeSelectorProps) {
  const { t } = useTranslation();

  const remoteCandidates = useMemo(() => {
    return [...nodes.values()]
      .filter((n) => n.node_id !== myNodeNum && n.node_id > 0)
      .sort((a, b) => getNodeName(a.node_id).localeCompare(getNodeName(b.node_id)));
  }, [nodes, myNodeNum, getNodeName]);

  const configTarget: ConfigTargetContext = useMemo(
    () => ({
      mode: configureTargetNodeNum != null ? 'remote' : 'local',
      nodeNum: configureTargetNodeNum,
      isReady: configureTargetNodeNum == null || remoteAdminStatus === 'ready',
      isLoading: remoteAdminStatus === 'loading',
      error: remoteAdminError,
      onRefresh,
    }),
    [configureTargetNodeNum, remoteAdminStatus, remoteAdminError, onRefresh],
  );

  if (!isLocalRadioConnected) {
    return <p className="text-muted text-xs">{t('configureNode.requiresLocalRadio')}</p>;
  }

  const selectedRemote =
    configureTargetNodeNum != null ? nodes.get(configureTargetNodeNum) : undefined;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label
          htmlFor="configure-node-select"
          className="text-muted shrink-0 text-xs font-medium uppercase"
        >
          {t('configureNode.label')}
        </label>
        <select
          id="configure-node-select"
          aria-label={t('configureNode.label')}
          className="bg-secondary-dark focus:border-brand-green max-w-md min-w-[12rem] flex-1 rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none"
          value={configureTargetNodeNum ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            onConfigureTargetChange(raw === '' ? null : Number(raw));
          }}
        >
          <option value="">{t('configureNode.localDevice')}</option>
          {remoteCandidates.map((node) => (
            <option key={node.node_id} value={node.node_id}>
              {getNodeName(node.node_id)} ({formatMeshtasticNodeId(node.node_id)})
            </option>
          ))}
        </select>
      </div>

      {configTarget.mode === 'remote' && selectedRemote && (
        <div
          className="rounded-lg border border-blue-700/50 bg-blue-900/20 px-3 py-2 text-sm text-blue-100"
          role="status"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t('configureNode.remoteBanner', {
                name: getNodeName(selectedRemote.node_id),
                nodeId: formatMeshtasticNodeId(selectedRemote.node_id),
              })}
            </span>
            <div className="flex gap-2">
              {onRefresh && (
                <button
                  type="button"
                  className="text-xs text-blue-300 hover:text-blue-200"
                  aria-label={t('configureNode.refresh')}
                  disabled={configTarget.isLoading}
                  onClick={() => {
                    void onRefresh();
                  }}
                >
                  {t('configureNode.refresh')}
                </button>
              )}
              <button
                type="button"
                className="text-xs text-blue-300 hover:text-blue-200"
                aria-label={t('configureNode.switchToLocal')}
                onClick={() => {
                  onConfigureTargetChange(null);
                }}
              >
                {t('configureNode.switchToLocal')}
              </button>
            </div>
          </div>
          {configTarget.isLoading && (
            <p className="text-muted mt-1 text-xs">{t('configureNode.loading')}</p>
          )}
          {configTarget.error && (
            <p className="mt-1 text-xs text-red-300">{t(configTarget.error)}</p>
          )}
        </div>
      )}
    </div>
  );
}

export type { ConfigTargetContext };
