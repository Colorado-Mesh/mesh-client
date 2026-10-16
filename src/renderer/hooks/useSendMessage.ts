import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '../components/Toast';
import { sendChatOnIdentity } from '../lib/sendChatOnIdentity';
import type { IdentityId } from '../lib/types';

/**
 * Chat's send function for one identity: {@link sendChatOnIdentity}, with Reticulum delivery
 * problems shown as toasts. Returns the provisional store id, or undefined when nothing was sent.
 */
export function useSendMessage(
  identityId: IdentityId | null,
): (
  text: string,
  channelIndex: number,
  destination?: number,
  replyTo?: string,
  retryOfStoreId?: string,
) => string | undefined {
  const { addToast } = useToast();
  const { t } = useTranslation();
  return useCallback(
    (
      text: string,
      channelIndex: number,
      destination?: number,
      replyTo?: string,
      retryOfStoreId?: string,
    ) => {
      if (!identityId) return;
      return sendChatOnIdentity(
        identityId,
        { text, channelIndex, destination, replyTo, retryOfStoreId },
        {
          onNoPropagationNode: () => {
            addToast(t('chatPanel.reticulumNoPropagationNode'), 'error');
          },
          onMissingLxmfDelivery: () => {
            addToast(t('chatPanel.reticulumChatNeedsLxmfDelivery'), 'error');
          },
        },
      );
    },
    [identityId, addToast, t],
  );
}
