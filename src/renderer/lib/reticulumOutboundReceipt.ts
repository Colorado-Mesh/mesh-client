import { getIdentityIdForProtocol } from '@/renderer/lib/identityByProtocol';
import { getOfflineIdentityIdForProtocol } from '@/renderer/lib/offlineProtocolIdentities';
import type { MessageStatus } from '@/renderer/stores/messageStore';
import { useMessageStore } from '@/renderer/stores/messageStore';

export const RETICULUM_RECEIPT_TIMEOUT_MS = 30_000;

export type ReticulumOutboundTerminal = 'acked' | 'failed' | 'timeout';

export function resolveReticulumIdentityId(): string | null {
  const identityId = getIdentityIdForProtocol('reticulum');
  if (identityId != null && identityId !== '') return identityId;
  return getOfflineIdentityIdForProtocol('reticulum');
}

function captureReticulumMessageIds(identityId: string): Set<string> {
  return new Set(Object.keys(useMessageStore.getState().messages[identityId] ?? {}));
}

/**
 * Follow one outbound attempt by store id. Pending → LXMF hash rekey is detected when
 * the tracked id disappears and exactly one new id appears in the same store update.
 */
export async function waitForReticulumOutboundTerminal(
  identityId: string,
  attemptStoreId: string,
  timeoutMs: number,
): Promise<ReticulumOutboundTerminal> {
  let trackedId = attemptStoreId;
  let knownIds = captureReticulumMessageIds(identityId);

  const readStatus = (): MessageStatus | undefined => {
    const messagesByIdentity = useMessageStore.getState().messages;
    if (!Object.hasOwn(messagesByIdentity, identityId)) return undefined;
    const byId = messagesByIdentity[identityId];
    const currentIds = new Set(Object.keys(byId));
    const added: string[] = [];
    for (const id of currentIds) {
      if (!knownIds.has(id)) added.push(id);
    }
    if (!currentIds.has(trackedId) && added.length === 1) {
      trackedId = added[0];
    }
    knownIds = currentIds;
    return Object.hasOwn(byId, trackedId) ? byId[trackedId].status : undefined;
  };

  const immediate = readStatus();
  if (immediate === 'acked' || immediate === 'failed') return immediate;
  return await new Promise<ReticulumOutboundTerminal>((resolve) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      resolve('timeout');
    }, timeoutMs);
    const unsubscribe = useMessageStore.subscribe(() => {
      const status = readStatus();
      if (status === 'acked' || status === 'failed') {
        clearTimeout(timeout);
        unsubscribe();
        resolve(status);
      }
    });
  });
}

/**
 * Resolve only when a Reticulum send attempt (store id returned by the send fn) reaches a
 * remote `acked` receipt. Throws `chatPanel.reticulumSendFailed` / `chatPanel.reticulumSendTimeout`
 * i18n keys otherwise so callers can keep the payload durable in the outbox.
 */
export async function assertReticulumSendAcked(
  identityId: string | null,
  sendResult: unknown,
  timeoutMs: number,
): Promise<void> {
  const attemptStoreId = typeof sendResult === 'string' && sendResult !== '' ? sendResult : null;
  if (identityId == null || attemptStoreId == null) {
    throw new Error('chatPanel.reticulumSendTimeout');
  }
  const receiptState = await waitForReticulumOutboundTerminal(
    identityId,
    attemptStoreId,
    timeoutMs,
  );
  if (receiptState === 'failed') {
    throw new Error('chatPanel.reticulumSendFailed');
  }
  if (receiptState !== 'acked') {
    throw new Error('chatPanel.reticulumSendTimeout');
  }
}
