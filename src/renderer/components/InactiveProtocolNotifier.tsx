import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage, MeshProtocol } from '@/renderer/lib/types';
import { REGISTERED_MESH_PROTOCOLS } from '@/renderer/lib/types';

import { useToast } from './Toast';

const PROTOCOL_DISPLAY_NAME: Record<MeshProtocol, string> = {
  meshtastic: 'Meshtastic',
  meshcore: 'MeshCore',
  reticulum: 'Reticulum',
};

export interface InactiveProtocolNotifierProps {
  activeProtocol: MeshProtocol;
  messagesByProtocol: Record<MeshProtocol, ChatMessage[]>;
}

/** Toast when the inactive protocol receives new chat messages. */
export function InactiveProtocolNotifier({
  activeProtocol,
  messagesByProtocol,
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
        const realNew = newMsgs.filter((m) => !m.emoji && !m.isHistory);
        if (realNew.length > 0) {
          addToast(
            t('toasts.newMessages', {
              protocol: PROTOCOL_DISPLAY_NAME[inactiveProtocol],
              count: realNew.length,
            }),
            'info',
            6000,
          );
        }
      }
      prevCountRef.current[inactiveProtocol] = count;
    }
  }, [activeProtocol, messagesByProtocol, addToast, t]);

  return null;
}
