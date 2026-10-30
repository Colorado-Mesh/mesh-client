import { type SetStateAction, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '../components/Toast';
import {
  loadMutedViews,
  notifyMutedViewsChanged,
  subscribeMutedViewsChanged,
} from '../lib/chatPanelProtocolStorage';
import {
  migrateLegacyConversationMutes,
  saveConversationMutes,
  setConversationMuteMqttClientId,
} from '../lib/conversationMuteStorage';
import type { MeshProtocol } from '../lib/types';
import { useConnectionStore } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import { useLiveChannelKeyStore } from '../stores/liveChannelKeyStore';
import { useNodeStore } from '../stores/nodeStore';
import { useReticulumIdentityStore } from '../stores/reticulumIdentityStore';

function subscribe(protocol: MeshProtocol, listener: () => void) {
  const discovered = () => {
    if (migrateLegacyConversationMutes(protocol)) notifyMutedViewsChanged(protocol);
    listener();
  };
  const unsubscribers = [
    subscribeMutedViewsChanged(listener),
    useIdentityStore.subscribe(discovered),
    useConnectionStore.subscribe(discovered),
    useLiveChannelKeyStore.subscribe(discovered),
    useNodeStore.subscribe(discovered),
    useReticulumIdentityStore.subscribe(discovered),
  ];
  window.addEventListener('storage', listener);
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    window.removeEventListener('storage', listener);
  };
}

/** Mount once from App so background MQTT alerts use the same identity as the bells. */
export function useConversationMuteMqttIdentity() {
  useEffect(() => {
    let disposed = false;
    const revisions = new Map<MeshProtocol, number>();
    const update = (protocol: MeshProtocol, clientId: string) => {
      setConversationMuteMqttClientId(protocol, clientId);
      migrateLegacyConversationMutes(protocol);
      notifyMutedViewsChanged(protocol);
    };
    const unsubscribe = window.electronAPI.mqtt.onClientId(({ protocol, clientId }) => {
      if (disposed) return;
      revisions.set(protocol, (revisions.get(protocol) ?? 0) + 1);
      update(protocol, clientId);
    });
    for (const protocol of ['meshtastic', 'meshcore'] as const) {
      const revision = revisions.get(protocol) ?? 0;
      void window.electronAPI.mqtt
        .getClientId(protocol)
        .then((clientId) => {
          if (!disposed && revision === (revisions.get(protocol) ?? 0)) update(protocol, clientId);
        })
        .catch((error: unknown) => {
          console.warn('[conversationMuteStorage] MQTT identity read failed', error);
        });
    }
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
}

export function useConversationMutes(protocol: MeshProtocol) {
  useEffect(() => {
    if (migrateLegacyConversationMutes(protocol)) notifyMutedViewsChanged(protocol);
  }, [protocol]);
  const { addToast } = useToast();
  const { t } = useTranslation();
  const subscribeToProtocol = useCallback(
    (listener: () => void) => subscribe(protocol, listener),
    [protocol],
  );
  const raw = useSyncExternalStore(subscribeToProtocol, () =>
    JSON.stringify([...loadMutedViews(protocol)]),
  );
  const views = useMemo(() => new Set<string>(JSON.parse(raw) as string[]), [raw]);
  const update = useCallback(
    (action: SetStateAction<Set<string>>) => {
      const before = loadMutedViews(protocol);
      const after = typeof action === 'function' ? action(before) : action;
      if (saveConversationMutes(protocol, before, after)) {
        notifyMutedViewsChanged(protocol);
        return true;
      }
      addToast(t('notificationPolicy.saveFailed'), 'error');
      return false;
    },
    [protocol, addToast, t],
  );
  return [views, update] as const;
}
