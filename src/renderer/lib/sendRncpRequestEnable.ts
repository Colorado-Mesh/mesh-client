import i18n from '@/renderer/lib/i18n';
import { tryConsumeRncpRequestEnableSlot } from '@/renderer/lib/rncpRequestEnableRateLimit';
import { buildRncpRequestEnableMessageBody } from '@/shared/rncpRequestEnable';

export type SendRncpRequestEnableResult =
  | { ok: true }
  | { ok: false; error: 'rate_limited' | 'invalid_peer' | 'send_failed'; detail?: string };

/**
 * Sends an ordinary LXMF DM asking the peer to enable rncp receive.
 * Body includes human-readable instructions + mesh-client sentinel.
 */
export async function sendRncpRequestEnable(
  peerLxmfHash: string,
): Promise<SendRncpRequestEnableResult> {
  const hash = peerLxmfHash.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hash.length !== 32) {
    return { ok: false, error: 'invalid_peer' };
  }
  if (!tryConsumeRncpRequestEnableSlot(hash)) {
    return { ok: false, error: 'rate_limited' };
  }
  const instructions = i18n.t('reticulumRemote.enableRequest.lxmfBody');
  const content = buildRncpRequestEnableMessageBody(instructions);
  try {
    const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/lxmf/send', {
      destination_hash: hash,
      content,
    })) as { ok?: boolean; error?: string };
    if (res?.ok === false) {
      return { ok: false, error: 'send_failed', detail: res.error };
    }
    return { ok: true };
  } catch (e) {
    // Failure is returned to the caller for a user-facing toast.
    console.debug('[sendRncpRequestEnable] ' + (e instanceof Error ? e.message : String(e)));
    return {
      ok: false,
      error: 'send_failed',
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
