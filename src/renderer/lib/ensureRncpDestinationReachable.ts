import { probeReticulumPeer } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { isCanonicalReticulumDestinationHash } from '@/shared/reticulumDestinationHash';

export type RncpDestinationReachability =
  | { status: 'reachable'; hops?: number }
  | { status: 'listenerLikelyOff' }
  | { status: 'peerUnreachable' };

export interface EnsureRncpDestinationReachableArgs {
  /** rncp.receive (or fetch) destination hash — required path for the transfer. */
  destinationHash: string;
  /**
   * Peer LXMF delivery hash when known (Chat DM always; Remote when saved).
   * Used only when the receive dest probe fails, to distinguish offline vs
   * listener-not-announcing.
   */
  lxmfPeerHash?: string | null;
}

/** True when `value` is already trimmed/lowercased 32-char hex (rncp/LXMF dest). */
export function isRncpHexHash(value: string): boolean {
  return isCanonicalReticulumDestinationHash(value);
}

/**
 * Preflight before rncp send/fetch: require a live path to the transfer destination.
 * When that fails but LXMF still probes ok, classify as listener-likely-off so the
 * UI can prompt an enable-request instead of queuing a stuck 0% transfer.
 */
export async function ensureRncpDestinationReachable(
  args: EnsureRncpDestinationReachableArgs,
): Promise<RncpDestinationReachability> {
  const destinationHash = args.destinationHash.trim().toLowerCase();
  if (!isRncpHexHash(destinationHash)) {
    return { status: 'peerUnreachable' };
  }

  let destProbe: Awaited<ReturnType<typeof probeReticulumPeer>>;
  try {
    destProbe = await probeReticulumPeer(destinationHash);
  } catch {
    // catch-no-log-ok probe failures classify as unreachable for the gate
    return { status: 'peerUnreachable' };
  }
  if (destProbe.ok) {
    return { status: 'reachable', hops: destProbe.hops };
  }

  const lxmf = args.lxmfPeerHash?.trim().toLowerCase() ?? '';
  if (!isRncpHexHash(lxmf) || lxmf === destinationHash) {
    return { status: 'peerUnreachable' };
  }

  let lxmfProbe: Awaited<ReturnType<typeof probeReticulumPeer>>;
  try {
    lxmfProbe = await probeReticulumPeer(lxmf);
  } catch {
    // catch-no-log-ok probe failures classify as unreachable for the gate
    return { status: 'peerUnreachable' };
  }
  if (lxmfProbe.ok) {
    return { status: 'listenerLikelyOff' };
  }
  return { status: 'peerUnreachable' };
}
