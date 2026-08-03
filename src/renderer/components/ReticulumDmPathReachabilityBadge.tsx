import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { ReticulumDmPathStatus } from '@/renderer/lib/reticulum/reticulumDmPathReachability';
import {
  formatReticulumPeerPathToast,
  formatReticulumPeerProbeToast,
  isReticulumSidecarRunning,
  probeReticulumPeer,
  requestReticulumPeerPath,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import {
  RETICULUM_DM_HEADER_ACTION_CLASS,
  RETICULUM_DM_HEADER_STATUS_CLASS,
} from '@/renderer/lib/reticulumDmHeaderActions';
import {
  refreshReticulumPeersFromSidecar,
  useReticulumPeerStore,
} from '@/renderer/stores/reticulumPeerStore';

import { HelpTooltip } from './HelpTooltip';
import { useToast } from './Toast';

export function ReticulumDmPathReachabilityBadge({
  status,
  hops,
}: {
  status: ReticulumDmPathStatus;
  hops: number | null;
}) {
  const { t } = useTranslation();
  if (status === 'idle') return null;

  const label =
    status === 'probing'
      ? t('chatPanel.dmPathChecking')
      : status === 'reachable'
        ? hops != null
          ? t('chatPanel.dmPathReachableHops', { hops })
          : t('chatPanel.dmPathReachable')
        : t('chatPanel.dmPathUnreachable');

  const tooltip =
    status === 'unreachable'
      ? t('chatPanel.dmPathUnreachableTooltip')
      : status === 'reachable'
        ? t('chatPanel.dmPathReachableTooltip')
        : t('chatPanel.dmPathCheckingTooltip');

  const ariaLabel =
    status === 'probing'
      ? t('chatPanel.dmPathCheckingAria')
      : status === 'reachable'
        ? t('chatPanel.dmPathReachableAria')
        : t('chatPanel.dmPathUnreachableAria');

  const textClass =
    status === 'probing'
      ? 'text-muted'
      : status === 'reachable'
        ? 'text-bright-green'
        : 'text-red-400';

  return (
    <HelpTooltip text={tooltip} className="shrink-0" ariaLabel={ariaLabel}>
      <span
        role="status"
        aria-label={ariaLabel}
        className={`${RETICULUM_DM_HEADER_STATUS_CLASS} ${textClass}`}
      >
        {status === 'probing' ? (
          <span
            className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent"
            aria-hidden
          />
        ) : (
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              status === 'reachable' ? 'bg-bright-green' : 'bg-red-500'
            }`}
            aria-hidden
          />
        )}
        <span aria-hidden>{label}</span>
      </span>
    </HelpTooltip>
  );
}

export interface ReticulumDmPathActionsProps {
  destinationHash: string;
  status: ReticulumDmPathStatus;
  /** Re-run the Chat DM path probe (also used after a successful path request). */
  onReprobe: () => void;
  /**
   * Apply a probe result from the manual Probe button (avoids a second /probe).
   * First arg is the destination that was probed so stale completions can be ignored.
   */
  onProbeSettled: (forHash: string, ok: boolean, hops: number | null) => void;
}

/** Manual path request / probe when auto reachability check has settled. */
export function ReticulumDmPathActions({
  destinationHash,
  status,
  onReprobe,
  onProbeSettled,
}: ReticulumDmPathActionsProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);

  // Busy resets on destination change via ChatPanel `key={destinationHash}` remount.
  if (status === 'idle' || status === 'probing') return null;

  const runPath = async () => {
    setBusy(true);
    try {
      if (!(await isReticulumSidecarRunning())) {
        addToast(t('connectionPanel.reticulumIdentity.startStackFirst'), 'error');
        return;
      }
      const result = await requestReticulumPeerPath(destinationHash);
      const toast = formatReticulumPeerPathToast(t, result);
      addToast(toast.message, toast.variant);
      if (result.ok) {
        await refreshReticulumPeersFromSidecar();
      }
      onReprobe();
    } catch (e) {
      console.warn('[ReticulumDmPathActions] path ' + errLikeToLogString(e));
    } finally {
      setBusy(false);
    }
  };

  const runProbe = async () => {
    const probedHash = destinationHash;
    setBusy(true);
    try {
      if (!(await isReticulumSidecarRunning())) {
        addToast(t('connectionPanel.reticulumIdentity.startStackFirst'), 'error');
        return;
      }
      const result = await probeReticulumPeer(probedHash);
      const toast = formatReticulumPeerProbeToast(t, result);
      addToast(toast.message, toast.variant);
      if (result.ok && result.hops != null) {
        useReticulumPeerStore.getState().updatePeer(probedHash, { hops: result.hops });
      }
      if (result.ok) {
        await refreshReticulumPeersFromSidecar();
      }
      onProbeSettled(probedHash, result.ok, result.hops ?? null);
    } catch (e) {
      console.warn('[ReticulumDmPathActions] probe ' + errLikeToLogString(e));
      onProbeSettled(probedHash, false, null);
    } finally {
      setBusy(false);
    }
  };

  // Probe first (active reachability), then Path (discovery request) — both use the
  // shared DM header outlined chip style so they match Call / Send file / Peer details.
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void runProbe();
        }}
        className={RETICULUM_DM_HEADER_ACTION_CLASS}
        aria-label={t('chatPanel.dmPathProbeAria')}
      >
        {t('connectionPanel.reticulumPeers.probe')}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void runPath();
        }}
        className={RETICULUM_DM_HEADER_ACTION_CLASS}
        aria-label={t('chatPanel.dmPathRequestPathAria')}
      >
        {t('connectionPanel.reticulumPeers.path')}
      </button>
    </div>
  );
}
