import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { getIdentityIdForProtocol } from '@/renderer/lib/identityByProtocol';
import {
  type HeardRepeater,
  type RelayCoverage,
  useRelayCoverageStore,
} from '@/renderer/lib/relayCoverage/relayCoverageStore';
import type { ChatMessage, MeshProtocol } from '@/renderer/lib/types';

function formatRepeaterDetail(r: HeardRepeater): string {
  const label = r.name?.trim() || `Node ${r.nodeId}`;
  return r.snr != null ? `${label} (${r.snr} dB)` : label;
}

function MeshcoreHeardLine({ coverage }: { coverage: RelayCoverage }): ReactElement | null {
  const { t } = useTranslation();
  const heard = coverage.heardRepeaters ?? [];
  if (heard.length === 0) return null;
  const names = heard.map((r) => r.name?.trim() || `Node ${r.nodeId}`).join(', ');
  const detail = heard.map(formatRepeaterDetail).join('; ');
  const label = t('chatPanel.heardByRepeaters', { count: heard.length });
  const detailLabel = t('chatPanel.heardByRepeatersDetail', {
    count: heard.length,
    names: detail || names,
  });
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
  if (coverage.predictedRelayHops == null) return null;
  const hop = coverage.predictedFirstHop?.trim().slice(0, 6) ?? '';
  const label = t('chatPanel.routeRelaysPredicted', {
    count: coverage.predictedRelayHops,
    hop,
  });
  return (
    <span className="text-xs text-cyan-400" aria-label={label} title={label}>
      {label}
    </span>
  );
}

/** Stable coverage lookup key matching filler writers (store canonical id / packet id). */
export function relayCoverageMessageKey(msg: ChatMessage): string | undefined {
  if (msg.storeId) return msg.storeId;
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
  const coverage = useRelayCoverageStore((s) =>
    identityId && messageId ? s.coverageFor(identityId, messageId) : undefined,
  );

  if (!isOwn || !identityId || !messageId || !coverage) return null;

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
