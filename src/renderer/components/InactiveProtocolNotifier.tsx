import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage, MeshProtocol } from '@/renderer/lib/types';
import { REGISTERED_MESH_PROTOCOLS } from '@/renderer/lib/types';

import { isMeshcoreRoomChatMessage } from '../hooks/meshcore/meshcoreHookPreamble';
import { getChatNotificationMode, mentionsLocalChatIdentity } from '../lib/chatNotificationPolicy';
import { loadMutedViews } from '../lib/chatPanelProtocolStorage';
import { chatViewKeyForMessage, resolveChatNotificationType } from '../lib/chatUnreadCounts';
import { useToast } from './Toast';

const EMPTY_OWN_IDS = new Set<number>();

export interface InactiveProtocolNotifierProps {
  activeProtocol: MeshProtocol;
  ownNodeIdsByProtocol?: Partial<Record<MeshProtocol, ReadonlySet<number>>>;
  messagesByProtocol: Record<MeshProtocol, ChatMessage[]>;
  /** Protocols enabled in App → Protocols; disabled ones never toast. */
  enabledProtocols?: readonly MeshProtocol[];
}

/** Toast when the inactive protocol receives new chat messages. */
export function InactiveProtocolNotifier({
  activeProtocol,
  ownNodeIdsByProtocol,
  messagesByProtocol,
  enabledProtocols = REGISTERED_MESH_PROTOCOLS,
}: InactiveProtocolNotifierProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
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
        prevCountRef.current[inactiveProtocol] = messagesByProtocol[inactiveProtocol].length;
        continue;
      }

      const count = messagesByProtocol[inactiveProtocol].length;
      if (isInitRef.current[inactiveProtocol]) {
        prevCountRef.current[inactiveProtocol] = count;
        if (count > 0) isInitRef.current[inactiveProtocol] = false;
        continue;
      }

      if (count > prevCountRef.current[inactiveProtocol]) {
        const newMsgs = messagesByProtocol[inactiveProtocol].slice(
          prevCountRef.current[inactiveProtocol],
        );
        const own = ownNodeIdsByProtocol?.[inactiveProtocol] ?? EMPTY_OWN_IDS;
        const mutedViews = loadMutedViews(inactiveProtocol);
        const realNew =
          localStorage.getItem('mesh-client:notifMuted') === '1'
            ? []
            : newMsgs.filter((m) => {
                if (m.emoji || m.isHistory || own.has(m.sender_id)) return false;
                // Room posts retain their existing passive toast, without adding a new sound path.
                if (isMeshcoreRoomChatMessage(m)) {
                  return (
                    !mutedViews.has(`room:${m.roomServerId}`) &&
                    (getChatNotificationMode() === 'all' ||
                      mentionsLocalChatIdentity(
                        m.payload,
                        inactiveProtocol,
                        own,
                        m.replyPreviewSender,
                      ))
                  );
                }
                return (
                  !mutedViews.has(chatViewKeyForMessage(m, inactiveProtocol, own)) &&
                  resolveChatNotificationType(
                    m,
                    messagesByProtocol[inactiveProtocol],
                    own,
                    inactiveProtocol,
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
  }, [activeProtocol, ownNodeIdsByProtocol, messagesByProtocol, enabledProtocols, addToast, t]);

  return null;
}
