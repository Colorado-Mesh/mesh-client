import i18n from '@/renderer/lib/i18n';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';
import { parseRncpReceiveDestShare } from '@/shared/rncpRequestEnable';

export type ApplyRncpReceiveDestShareResult =
  | { ok: true; receiveHash: string; lxmfPeerHash: string }
  | { ok: false; reason: 'no_share' | 'invalid_sender' | 'upsert_failed' };

/**
 * If an inbound LXMF body shares an rncp.receive destination, persist the
 * lxmf_peer_hash → rncp destination mapping for Chat DM / Transfer autofill.
 */
export async function applyRncpReceiveDestShareFromLxmf(opts: {
  senderHash: string | null | undefined;
  senderName?: string | null;
  text: string | null | undefined;
}): Promise<ApplyRncpReceiveDestShareResult> {
  const receiveHash = parseRncpReceiveDestShare(opts.text);
  if (!receiveHash) return { ok: false, reason: 'no_share' };

  const lxmfPeerHash = canonicalizeReticulumDestinationHash(opts.senderHash ?? '');
  if (!lxmfPeerHash) return { ok: false, reason: 'invalid_sender' };

  const label =
    opts.senderName?.trim() ||
    useReticulumRemoteAddressStore.getState().findByLxmfPeer(lxmfPeerHash)?.label ||
    lxmfPeerHash.slice(0, 12);

  const existing = useReticulumRemoteAddressStore.getState().findByLxmfPeer(lxmfPeerHash);
  const row = await useReticulumRemoteAddressStore.getState().upsert({
    id: existing?.id,
    label,
    service: 'rncp',
    destination_hash: receiveHash,
    lxmf_peer_hash: lxmfPeerHash,
    identity_hash: existing?.identity_hash ?? null,
  });
  if (!row) return { ok: false, reason: 'upsert_failed' };

  return { ok: true, receiveHash, lxmfPeerHash };
}

/** Human-readable toast after a successful share ingest. */
export function rncpReceiveDestShareSavedToastMessage(peerLabel: string): string {
  return i18n.t('reticulumRemote.transfer.receiveDestSharedToast', { peer: peerLabel });
}
