import { useEffect } from 'react';

import { requestOpenSetting } from '@/renderer/lib/openSettingRequest';
import { translationMessageKey } from '@/renderer/lib/translation/helpers';
import {
  ensureTranslationStatus,
  IDLE_MESSAGE_TRANSLATION,
  translateMessage,
  useTranslationStore,
} from '@/renderer/stores/translationStore';

export function useMessageTranslation(messageKey: string, text: string) {
  const target = useTranslationStore((store) => store.preferences.target);
  const enabled = useTranslationStore((store) => store.status?.enabled ?? false);
  const libreEnabled = useTranslationStore((store) =>
    Boolean(store.status?.enabled && store.status.libre.enabled),
  );
  const key = translationMessageKey(messageKey, text, target);
  const state = useTranslationStore((store) => store.messages.get(key) ?? IDLE_MESSAGE_TRANSLATION);
  useEffect(() => {
    ensureTranslationStatus();
  }, []);
  const openSettings = () => {
    requestOpenSetting({ slot: 'App', id: 'app.translation' });
  };
  return {
    key,
    state,
    libreEnabled,
    openSettings,
    translate: (provider: 'offline' | 'libre' = 'offline') => {
      if (!enabled) {
        openSettings();
        return Promise.resolve();
      }
      return translateMessage(key, text, provider);
    },
    toggle: () => {
      useTranslationStore.getState().toggle(key);
    },
  };
}
