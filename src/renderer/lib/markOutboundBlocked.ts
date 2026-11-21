import { updateMessageStatus } from '../stores/messageStore';
import {
  CHAT_SEND_ERROR_DEST_KEY_KEY,
  isEncryptionBlockedSendError,
  persistableChatSendError,
} from './chatSendErrorI18n';
import type { IdentityId } from './types';

/**
 * Mark an optimistic outbound chat row as permanently blocked (missing key / orphan contact).
 * Persists an i18n key so the badge shows Blocked instead of USB/BT no ACK, and auto-resend skips it.
 */
export function markOutboundBlocked(
  identityId: IdentityId,
  messageId: string,
  err: unknown = CHAT_SEND_ERROR_DEST_KEY_KEY,
): string {
  const persistable = persistableChatSendError(err);
  const error =
    isEncryptionBlockedSendError(persistable) || isEncryptionBlockedSendError(String(err))
      ? persistable
      : CHAT_SEND_ERROR_DEST_KEY_KEY;
  updateMessageStatus(identityId, messageId, 'blocked', error);
  return error;
}
