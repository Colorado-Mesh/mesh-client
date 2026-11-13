import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWordFilterStore } from '../../stores/wordFilterStore';
import { CHECKBOX_CLASS, INPUT_BOX_SM_CLASS } from '../ui/formClasses';

/** Chat settings: enable word filter and edit the blocked word list. */
export function WordFilterSettings({ conversationKey }: { conversationKey?: string }) {
  const { t } = useTranslation();
  const enabled = useWordFilterStore((s) => s.enabled);
  const setEnabled = useWordFilterStore((s) => s.setEnabled);
  const words = useWordFilterStore((s) => s.words);
  const setWordsText = useWordFilterStore((s) => s.setWordsText);
  const disabledConversations = useWordFilterStore((s) => s.disabledConversations);
  const setConversationDisabled = useWordFilterStore((s) => s.setConversationDisabled);
  const [draft, setDraft] = useState(words.join(', '));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset local draft after durable word-filter hydration
    setDraft(words.join(', '));
  }, [words]);

  const commit = () => {
    setWordsText(draft);
  };

  const convDisabled = conversationKey != null ? disabledConversations.has(conversationKey) : false;

  return (
    <div
      className="mb-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1"
      data-testid="word-filter-settings"
      role="group"
      aria-label={t('wordFilter.settingsTitle')}
    >
      <label
        className="text-muted flex cursor-pointer items-center gap-2 text-xs"
        data-setting-anchor="chat.wordFilter.enabled"
      >
        <input
          type="checkbox"
          className={CHECKBOX_CLASS}
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
          }}
        />
        {t('wordFilter.enabled')}
      </label>
      {conversationKey ? (
        <label
          className="text-muted flex cursor-pointer items-center gap-2 text-xs"
          data-setting-anchor="chat.wordFilter.disableConversation"
        >
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={convDisabled}
            onChange={(e) => {
              setConversationDisabled(conversationKey, e.target.checked);
            }}
          />
          {t('wordFilter.disableConversation')}
        </label>
      ) : null}
      <div
        className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md"
        data-setting-anchor="chat.wordFilter.words"
      >
        <input
          type="text"
          className={`${INPUT_BOX_SM_CLASS} min-w-0 flex-1 font-mono`}
          value={draft}
          placeholder={t('wordFilter.wordsPlaceholder')}
          aria-label={t('wordFilter.wordsAria')}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
      </div>
    </div>
  );
}
