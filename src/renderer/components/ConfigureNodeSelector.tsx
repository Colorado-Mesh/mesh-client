import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';

import { meshcoreHwModelIsContactTypeLabel } from '../lib/meshcoreUtils';
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

function remoteCandidateLabel(node: MeshNode, getNodeName: (nodeNum: number) => string): string {
  const name = getNodeName(node.node_id);
  const id = formatMeshtasticNodeId(node.node_id);
  const prefix = node.favorited ? '★ ' : '';
  return `${prefix}${name} (${id})`;
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
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const remoteCandidates = useMemo(() => {
    return [...nodes.values()]
      .filter(
        (n) =>
          n.node_id !== myNodeNum &&
          n.node_id > 0 &&
          !meshcoreHwModelIsContactTypeLabel(n.hw_model),
      )
      .sort((a, b) => {
        const aFav = a.favorited ? 1 : 0;
        const bFav = b.favorited ? 1 : 0;
        if (aFav !== bFav) return bFav - aFav;
        return getNodeName(a.node_id).localeCompare(getNodeName(b.node_id));
      });
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

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!isLocalRadioConnected) {
    return <p className="text-muted text-xs">{t('configureNode.requiresLocalRadio')}</p>;
  }

  const selectedRemote =
    configureTargetNodeNum != null ? nodes.get(configureTargetNodeNum) : undefined;

  const triggerLabel =
    configureTargetNodeNum == null
      ? t('configureNode.localDevice')
      : selectedRemote
        ? remoteCandidateLabel(selectedRemote, getNodeName)
        : `${getNodeName(configureTargetNodeNum)} (${formatMeshtasticNodeId(configureTargetNodeNum)})`;

  const handleSelect = (nodeNum: number | null) => {
    onConfigureTargetChange(nodeNum);
    setIsOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          id="configure-node-select-label"
          className="text-muted shrink-0 text-xs font-medium uppercase"
        >
          {t('configureNode.label')}
        </span>
        <div ref={containerRef} className="relative max-w-md min-w-[12rem] flex-1">
          <button
            type="button"
            id="configure-node-select"
            aria-labelledby="configure-node-select-label"
            aria-label={t('configureNode.label')}
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            onClick={() => {
              setIsOpen((o) => !o);
            }}
            className="bg-secondary-dark focus:border-brand-green flex w-full items-center justify-between gap-2 rounded-lg border border-gray-600 px-3 py-2 text-left text-sm text-gray-200 focus:outline-none"
          >
            <span className="truncate">{triggerLabel}</span>
            <span className="text-muted shrink-0 text-xs" aria-hidden="true">
              {isOpen ? '▴' : '▾'}
            </span>
          </button>

          {isOpen && (
            <ul
              role="listbox"
              aria-label={t('configureNode.label')}
              className="bg-deep-black absolute top-full right-0 left-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-700 py-1 shadow-xl"
            >
              <li role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={configureTargetNodeNum == null}
                  onClick={() => {
                    handleSelect(null);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                    configureTargetNodeNum == null
                      ? 'text-brand-green bg-gray-800'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
                  }`}
                >
                  {t('configureNode.localDevice')}
                </button>
              </li>
              {remoteCandidates.map((node) => (
                <li key={node.node_id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={configureTargetNodeNum === node.node_id}
                    onClick={() => {
                      handleSelect(node.node_id);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                      configureTargetNodeNum === node.node_id
                        ? 'text-brand-green bg-gray-800'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
                    }`}
                  >
                    {remoteCandidateLabel(node, getNodeName)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {configTarget.mode === 'remote' && configTarget.error && (
        <div
          className="rounded-lg border border-red-700/50 bg-red-900/20 px-3 py-2 text-sm text-red-200"
          role="alert"
        >
          {t(configTarget.error)}
        </div>
      )}

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
        </div>
      )}
    </div>
  );
}

export type { ConfigTargetContext };
