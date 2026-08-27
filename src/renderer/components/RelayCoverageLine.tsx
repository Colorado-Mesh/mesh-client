import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { getIdentityIdForProtocol } from '@/renderer/lib/identityByProtocol';
import { isSyntheticHeardNodeId } from '@/renderer/lib/meshcore/heardRepeatTracker';
import {
  type HeardRepeater,
  type RelayCoverage,
  relayCoverageKey,
  useRelayCoverageStore,
} from '@/renderer/lib/relayCoverage/relayCoverageStore';
import type { ChatMessage, MeshProtocol } from '@/renderer/lib/types';

function MeshcoreHeardLine({ coverage }: { coverage: RelayCoverage }): ReactElement | null {
  const { t } = useTranslation();
  const heard = coverage.heardRepeaters ?? [];
  if (heard.length === 0) return null;

  const named: HeardRepeater[] = [];
  const additional: HeardRepeater[] = [];
  for (const r of heard) {
    if (isSyntheticHeardNodeId(r.nodeId)) additional.push(r);
    else named.push(r);
  }

  const fallback = (r: HeardRepeater) =>
    r.name?.trim() || t('chatPanel.heardByRepeaterNodeFallback', { nodeId: r.nodeId });
  const namedDetail = named
    .map((r) => {
      const label = fallback(r);
      return r.snr != null ? `${label} (${r.snr} dB)` : label;
    })
    .join('; ');
  const hashes = additional
    .map((r) => r.name?.trim() || fallback(r))
    .filter(Boolean)
    .join(', ');

  const label = t('chatPanel.heardByRepeaters', { count: heard.length });
  const parts: string[] = [];
  if (named.length > 0) {
    parts.push(
      t('chatPanel.heardByRepeatersDetail', {
        count: named.length,
        names: namedDetail,
      }),
    );
  }
  if (additional.length > 0) {
    parts.push(
      t('chatPanel.heardByRepeatersAdditional', {
        count: additional.length,
        hashes,
      }),
    );
  }
  const detailLabel = parts.join(' · ') || label;

  return (
    <span className="text-xs text-green-400" aria-label={detailLabel} title={detailLabel}>
      {label}
    </span>
  );
}

function MeshtasticHeardLine({ coverage }: { coverage: RelayCoverage }): ReactElement | null {
  const { t } = useTranslation();
  if (coverage.broadcastHeard === true) {
    const label = t('chatPanel.heardByNetwork');
    return (
      <span className="text-xs text-green-400" aria-label={label} title={label}>
        {label}
      </span>
    );
  }
  if (coverage.broadcastHeard === false) {
    const label = t('chatPanel.notHeardTimeout');
    return (
      <span className="text-xs text-amber-400" aria-label={label} title={label}>
        {label}
      </span>
    );
  }
  return null;
}

function ReticulumRouteLine({ coverage }: { coverage: RelayCoverage }): ReactElement | null {
  const { t } = useTranslation();
  const hop = coverage.predictedFirstHop?.trim().slice(0, 6) ?? '';
  if (coverage.predictedRelayHops != null) {
    const label = hop
      ? t('chatPanel.routeRelaysPredicted', {
          count: coverage.predictedRelayHops,
          hop,
        })
      : t('chatPanel.routeRelaysPredictedHopsOnly', {
          count: coverage.predictedRelayHops,
        });
    return (
      <span className="text-xs text-cyan-400" aria-label={label} title={label}>
        {label}
      </span>
    );
  }
  if (hop) {
    const label = t('chatPanel.routeViaPredicted', { hop });
    return (
      <span className="text-xs text-cyan-400" aria-label={label} title={label}>
        {label}
      </span>
    );
  }
  return null;
}

/** Stable coverage lookup key matching filler writers (store canonical id / packet id). */
export function relayCoverageMessageKey(msg: ChatMessage): string | undefined {
  if (msg.storeId) return msg.storeId;
  if (msg.reticulum_message_hash) return msg.reticulum_message_hash;
  if (msg.id != null) return String(msg.id);
  if (msg.packetId != null) return String(msg.packetId);
  return undefined;
}

export interface RelayCoverageLineProps {
  protocol: MeshProtocol;
  messageId: string | undefined;
  isOwn: boolean;
  /** Override identity for tests; default resolves via getIdentityIdForProtocol. */
  identityId?: string | null;
}

/**
 * Inline relay-coverage affordance for an outgoing chat bubble.
 * Coverage is in-memory only (see relayCoverageStore).
 */
export function RelayCoverageLine({
  protocol,
  messageId,
  isOwn,
  identityId: identityIdProp,
}: RelayCoverageLineProps): ReactElement | null {
  const identityId = identityIdProp ?? getIdentityIdForProtocol(protocol);
  const coverageKey = identityId && messageId ? relayCoverageKey(identityId, messageId) : null;
  const coverage = useRelayCoverageStore((s) =>
    coverageKey ? s.coverage[coverageKey] : undefined,
  );

  if (!isOwn || !identityId || !messageId || !coverage) return null;
  // Ignore stale keys if an identity id is reused across protocol tabs.
  if (coverage.protocol !== protocol) return null;

  // Mode is protocol-unique for this store; avoid protocol === '…' string gates.
  if (coverage.mode === 'confirmed') {
    return <MeshcoreHeardLine coverage={coverage} />;
  }
  if (coverage.mode === 'binary-heard') {
    return <MeshtasticHeardLine coverage={coverage} />;
  }
  if (coverage.mode === 'predicted') {
    return <ReticulumRouteLine coverage={coverage} />;
  }
  return null;
}
