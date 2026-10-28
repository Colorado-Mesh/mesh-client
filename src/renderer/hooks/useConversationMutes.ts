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
} from '../lib/conversationMuteStorage';
import type { MeshProtocol } from '../lib/types';
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
      if (saveConversationMutes(protocol, before, after)) notifyMutedViewsChanged(protocol);
      else addToast(t('notificationPolicy.saveFailed'), 'error');
    },
    [protocol, addToast, t],
  );
  return [views, update] as const;
}
