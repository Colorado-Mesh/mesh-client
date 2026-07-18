import { useTranslation } from 'react-i18next';

import type { MeshcorePathChainSegment } from '../lib/meshcorePathChainDisplay';

export interface MeshcoreRouteChainProps {
  segments: readonly MeshcorePathChainSegment[];
  /** Destination display name (always shown at the end when not direct). */
  destLabel: string;
  /**
   * When true (default), treat a single segment / empty intermediate hops as a direct link.
   * Renders the i18n "Direct" label instead of a chain.
   */
  treatSingleSegmentAsDirect?: boolean;
  className?: string;
}

/**
 * MeshCore route chain: Me → repeater names → destination (or "Direct").
 */
export function MeshcoreRouteChain({
  segments,
  destLabel,
  treatSingleSegmentAsDirect = true,
  className = '',
}: Readonly<MeshcoreRouteChainProps>) {
  const { t } = useTranslation();

  if (segments.length === 0 || (treatSingleSegmentAsDirect && segments.length <= 1)) {
    return (
      <span className={`text-xs text-gray-300 ${className}`}>{t('meshcoreRoute.direct')}</span>
    );
  }

  // Last segment is typically the destination hash prefix; show named dest instead.
  const intermediates = segments.slice(0, -1);

  return (
    <span className={`inline-flex flex-wrap items-center gap-1 text-xs ${className}`}>
      <span className="text-brand-green">{t('meshcoreRoute.me')}</span>
      {intermediates.map((seg, i) => {
        const label = seg.resolvedLabel ?? seg.hex;
        const title = seg.resolvedLabel
          ? t('meshcoreRoute.segmentResolvedTooltip', { hex: seg.hex, name: seg.resolvedLabel })
          : t('meshcoreRoute.segmentTooltip', { hex: seg.hex });
        return (
          <span key={`${seg.hex}-${i}`} className="inline-flex items-center gap-1">
            <span className="text-gray-600">→</span>
            <span
              className="rounded bg-blue-900/40 px-1.5 py-0.5 font-mono text-blue-300"
              title={title}
            >
              {label}
            </span>
          </span>
        );
      })}
      <span className="text-gray-600">→</span>
      <span className="text-white">▣ {destLabel}</span>
    </span>
  );
}
