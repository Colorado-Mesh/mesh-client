import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage, IdentityId, MeshProtocol } from '@/renderer/lib/types';
import { REGISTERED_MESH_PROTOCOLS } from '@/renderer/lib/types';

import { isMeshcoreRoomChatMessage } from '../hooks/meshcore/meshcoreHookPreamble';
import { useAllProtocolChatMessages } from '../hooks/useAllProtocolChatMessages';
import { getChatNotificationMode, mentionsLocalChatIdentity } from '../lib/chatNotificationPolicy';
import { loadMutedViews } from '../lib/chatPanelProtocolStorage';
import { chatViewKeyForMessage, resolveChatNotificationType } from '../lib/chatUnreadCounts';
import { isMecpMessage } from '../lib/mecp/mecpMessages';
import type { ChannelRemapContext } from '../lib/remapChannelMessagesToLiveSlots';
import { buildMeshtasticReplyParentIndex } from '../lib/replyPreview';
import { useToast } from './Toast';

const EMPTY_OWN_IDS = new Set<number>();
const EMPTY_IDENTITY_IDS: Record<MeshProtocol, IdentityId | null> = {
  meshtastic: null,
  meshcore: null,
  reticulum: null,
};

export interface InactiveProtocolNotifierProps {
  activeProtocol: MeshProtocol;
  ownNodeIdsByProtocol?: Partial<Record<MeshProtocol, ReadonlySet<number>>>;
  /**
   * Prefer identity-scoped store subscription. When set, `messagesByProtocol` is ignored
   * (kept for unit tests that inject arrays without a store).
   */
  identityIdByProtocol?: Record<MeshProtocol, IdentityId | null>;
  meshtasticRemap?: ChannelRemapContext | null;
  meshcoreRemap?: ChannelRemapContext | null;
  meshcoreSelfNodeId?: number;
  /** Test / legacy inject — used only when `identityIdByProtocol` is omitted. */
  messagesByProtocol?: Record<MeshProtocol, ChatMessage[]>;
  /** Protocols enabled in App → Protocols; disabled ones never toast. */
  enabledProtocols?: readonly MeshProtocol[];
}

function useInactiveProtocolMessages(
  identityIdByProtocol: Record<MeshProtocol, IdentityId | null> | undefined,
  messagesByProtocol: Record<MeshProtocol, ChatMessage[]> | undefined,
  meshtasticRemap: ChannelRemapContext | null | undefined,
  meshcoreRemap: ChannelRemapContext | null | undefined,
  meshcoreSelfNodeId: number | undefined,
): Record<MeshProtocol, ChatMessage[]> {
  const fromStore = useAllProtocolChatMessages({
    identityIdByProtocol: identityIdByProtocol ?? EMPTY_IDENTITY_IDS,
    meshtasticRemap,
    meshcoreRemap,
    meshcoreSelfNodeId,
  });
  if (identityIdByProtocol) return fromStore;
  return (
    messagesByProtocol ?? {
      meshtastic: [],
      meshcore: [],
      reticulum: [],
    }
  );
}

/** Toast when the inactive protocol receives new chat messages. */
export function InactiveProtocolNotifier({
  activeProtocol,
  ownNodeIdsByProtocol,
  identityIdByProtocol,
  meshtasticRemap,
  meshcoreRemap,
  meshcoreSelfNodeId,
  messagesByProtocol,
  enabledProtocols = REGISTERED_MESH_PROTOCOLS,
}: InactiveProtocolNotifierProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const resolvedMessages = useInactiveProtocolMessages(
    identityIdByProtocol,
    messagesByProtocol,
    meshtasticRemap,
    meshcoreRemap,
    meshcoreSelfNodeId,
  );
  const prevCountRef = useRef<Record<MeshProtocol, number>>(
    Object.fromEntries(REGISTERED_MESH_PROTOCOLS.map((p) => [p, 0])) as Record<
      MeshProtocol,
      number
    >,
  );
  const isInitRef = useRef<Record<MeshProtocol, boolean>>(
    Object.fromEntries(REGISTERED_MESH_PROTOCOLS.map((p) => [p, true])) as Record<
      MeshProtocol,
      boolean
    >,
  );

  useEffect(() => {
    for (const inactiveProtocol of REGISTERED_MESH_PROTOCOLS) {
      if (inactiveProtocol === activeProtocol) {
        isInitRef.current[inactiveProtocol] = true;
        prevCountRef.current[inactiveProtocol] = resolvedMessages[inactiveProtocol].length;
        continue;
      }

      const count = resolvedMessages[inactiveProtocol].length;
      if (isInitRef.current[inactiveProtocol]) {
        prevCountRef.current[inactiveProtocol] = count;
        if (count > 0) isInitRef.current[inactiveProtocol] = false;
        continue;
      }

      if (count > prevCountRef.current[inactiveProtocol]) {
        const newMsgs = resolvedMessages[inactiveProtocol].slice(
          prevCountRef.current[inactiveProtocol],
        );
        const own = ownNodeIdsByProtocol?.[inactiveProtocol] ?? EMPTY_OWN_IDS;
        const mutedViews = loadMutedViews(inactiveProtocol);
        const allForProtocol = resolvedMessages[inactiveProtocol];
        const meshtasticReplyIndex =
          inactiveProtocol === 'meshtastic'
            ? buildMeshtasticReplyParentIndex(allForProtocol)
            : undefined;
        const realNew = newMsgs.filter((m) => {
          if (m.emoji || m.isHistory || own.has(m.sender_id)) return false;
          // Preserve the existing passive emergency toast; dedicated MECP
          // alert owners continue to enforce their own severity/mute policy.
          if (isMecpMessage(m.payload)) return true;
          if (localStorage.getItem('mesh-client:notifMuted') === '1') return false;
          // Room posts retain their existing passive toast, without adding a new sound path.
          if (isMeshcoreRoomChatMessage(m)) {
            return (
              !mutedViews.has(`room:${m.roomServerId}`) &&
              (getChatNotificationMode() === 'all' ||
                mentionsLocalChatIdentity(m.payload, inactiveProtocol, own, m.replyPreviewSender))
            );
          }
          return (
            !mutedViews.has(chatViewKeyForMessage(m, inactiveProtocol, own)) &&
            resolveChatNotificationType(
              m,
              allForProtocol,
              own,
              inactiveProtocol,
              undefined,
              meshtasticReplyIndex,
            ) != null
          );
        });
        if (realNew.length > 0 && enabledProtocols.includes(inactiveProtocol)) {
          addToast(
            t('toasts.newMessages', {
              protocol: t(`connectionPanel.bleOwner.${inactiveProtocol}`),
              count: realNew.length,
            }),
            'info',
            6000,
          );
        }
      }
      prevCountRef.current[inactiveProtocol] = count;
    }
  }, [activeProtocol, ownNodeIdsByProtocol, resolvedMessages, enabledProtocols, addToast, t]);

  return null;
}
