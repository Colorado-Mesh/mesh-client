import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getChatNotificationMode,
  saveChatNotificationMode,
  subscribeChatNotificationMode,
} from '../lib/chatNotificationPolicy';
import { SELECT_CLASS } from './ui/formClasses';

export function ChatNotificationPolicySettings() {
  const { t } = useTranslation();
  const mode = useSyncExternalStore(subscribeChatNotificationMode, getChatNotificationMode);
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-2">
      <label htmlFor="chatNotificationMode" className="text-ink-300 block text-sm">
        {t('notificationPolicy.label')}
      </label>
      <select
        id="chatNotificationMode"
        aria-label={t('notificationPolicy.label')}
        aria-describedby="chatNotificationModeHelp"
        className={`${SELECT_CLASS} w-full sm:w-auto`}
        value={mode}
        onChange={(event) => {
          setFailed(
            !saveChatNotificationMode(event.target.value === 'mentions' ? 'mentions' : 'all'),
          );
        }}
      >
        <option value="all">{t('notificationPolicy.all')}</option>
        <option value="mentions">{t('notificationPolicy.mentions')}</option>
      </select>
      <p id="chatNotificationModeHelp" className="text-muted text-xs leading-relaxed">
        {t('notificationPolicy.help')}
      </p>
      {failed && (
        <p role="alert" className="text-xs text-red-400">
          {t('notificationPolicy.saveFailed')}
        </p>
      )}
    </div>
  );
}
