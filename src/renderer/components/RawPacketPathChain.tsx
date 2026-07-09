import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { NodeHashCandidate } from '../../shared/meshcoreNodeHash';
import {
  buildMeshcorePathChainSegments,
  type MeshcorePathChainSegment,
} from '../lib/meshcorePathChainDisplay';

export interface RawPacketPathChainProps {
  pathBytes: readonly number[];
  hashSizeBytes: 1 | 2 | 3;
  getNodeLabel: (nodeId: number) => string;
  pubKeyByNodeId?: ReadonlyMap<number, Uint8Array>;
  pathCandidates?: readonly NodeHashCandidate[];
  className?: string;
}

function PathSegmentChip({
  segment,
  t,
}: {
  segment: MeshcorePathChainSegment;
  t: (key: string, opts?: Record<string, string>) => string;
}) {
  const title = segment.resolvedLabel
    ? t('rawPacketLog.pathSegmentResolvedTooltip', {
        hex: segment.hex,
        name: segment.resolvedLabel,
      })
    : t('rawPacketLog.pathSegmentTooltip', { hex: segment.hex });
  return (
    <span
      className="rounded bg-blue-950/70 px-1 py-0.5 font-mono text-[10px] text-blue-200"
      title={title}
    >
      {segment.hex}
    </span>
  );
}

export function RawPacketPathChain({
  pathBytes,
  hashSizeBytes,
  getNodeLabel,
  pubKeyByNodeId,
  pathCandidates,
  className = '',
}: RawPacketPathChainProps) {
  const { t } = useTranslation();
  const segments = useMemo(
    () =>
      buildMeshcorePathChainSegments({
        pathBytes,
        hashSizeBytes,
        getNodeLabel,
        pubKeyByNodeId,
        candidates: pathCandidates,
      }),
    [pathBytes, hashSizeBytes, getNodeLabel, pubKeyByNodeId, pathCandidates],
  );

  if (segments.length === 0) {
    return (
      <span
        className={`text-muted shrink-0 ${className}`}
        title={t('rawPacketLog.pathEmptyTooltip')}
      >
        {t('common.emDash')}
      </span>
    );
  }

  const chainLabel = segments.map((s) => s.resolvedLabel ?? s.hex).join(' → ');

  return (
    <span
      className={`inline-flex min-w-0 flex-wrap items-center gap-0.5 ${className}`}
      title={t('rawPacketLog.pathChainTooltip', { path: chainLabel })}
    >
      {segments.map((seg, i) => (
        <span key={`${seg.hex}-${i}`} className="inline-flex items-center gap-0.5">
          {i > 0 ? <span className="text-muted text-[10px]">→</span> : null}
          <PathSegmentChip segment={seg} t={t} />
        </span>
      ))}
    </span>
  );
}
