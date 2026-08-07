import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { hasEffectiveReticulumPropagationTarget } from '@/renderer/lib/reticulum/reticulumPropagationEffective';
import {
  configuredPropagationDestinationHashes,
  pickAutoPropagationTarget,
  readReticulumPropagationMode,
} from '@/renderer/lib/reticulum/reticulumPropagationMode';
import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

export interface ReticulumPropagationNoticeProps {
  stackLive: boolean;
  onOpenPropagationSettings?: () => void;
}

/** Persistent banner when the stack is up but no remote propagation node is configured. */
export function ReticulumPropagationNotice({
  stackLive,
  onOpenPropagationSettings,
}: ReticulumPropagationNoticeProps) {
  const { t } = useTranslation();
  const nodes = useReticulumPropagationStore((s) => s.nodes);
  const discovered = useReticulumPropagationStore((s) => s.discovered);
  const preferredId = useReticulumPropagationStore((s) => s.preferredId);
  const refreshFromSidecar = useReticulumPropagationStore((s) => s.refreshFromSidecar);
  const addFromDiscovered = useReticulumPropagationStore((s) => s.addFromDiscovered);
  const mode = readReticulumPropagationMode();
  const isAuto = mode === 'auto';

  useEffect(() => {
    if (!stackLive) return;
    void refreshFromSidecar();
  }, [stackLive, refreshFromSidecar]);

  const configuredHashes = useMemo(() => configuredPropagationDestinationHashes(nodes), [nodes]);

  const unconfiguredDiscovered = useMemo(
    () =>
      discovered
        .filter((d) => !configuredHashes.has(d.destination_hash.toLowerCase()))
        .filter((d) => d.node_state)
        .slice()
        .sort((a, b) => (a.hops ?? 255) - (b.hops ?? 255)),
    [discovered, configuredHashes],
  );

  if (!stackLive) return null;
  if (hasEffectiveReticulumPropagationTarget(nodes, preferredId, mode, discovered)) {
    return null;
  }

  const discoveryCount = unconfiguredDiscovered.length;
  // Align "Add closest" with Auto pick when Auto is off (Auto soft-upserts itself).
  const closestTarget = pickAutoPropagationTarget(nodes, discovered);
  const closestHash =
    closestTarget?.kind === 'discovered'
      ? closestTarget.destinationHash
      : unconfiguredDiscovered[0]?.destination_hash;

  return (
    <div
      role="alert"
      className="mb-2 rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-100"
    >
      <p>
        {discoveryCount > 0
          ? t('reticulumPropagation.notice.bodyWithDiscoveries', { count: discoveryCount })
          : t('reticulumPropagation.notice.body')}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-3">
        {closestHash && !isAuto ? (
          <button
            type="button"
            className="font-medium text-amber-200 underline hover:text-amber-100"
            aria-label={t('reticulumPropagation.notice.addClosestAria')}
            onClick={() => {
              void addFromDiscovered(closestHash, { prefer: true });
            }}
          >
            {t('reticulumPropagation.notice.addClosest')}
          </button>
        ) : null}
        {onOpenPropagationSettings ? (
          <button
            type="button"
            className="font-medium text-amber-200 underline hover:text-amber-100"
            aria-label={t('reticulumPropagation.notice.openSettingsAria')}
            onClick={onOpenPropagationSettings}
          >
            {t('reticulumPropagation.notice.openSettings')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
