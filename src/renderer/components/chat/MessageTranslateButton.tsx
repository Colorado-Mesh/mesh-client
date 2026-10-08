import { Languages, PARENT_HOVER_ATTR } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { useMessageTranslation } from '@/renderer/hooks/useMessageTranslation';

export interface MessageTranslationProps {
  messageKey: string;
  text: string;
  incoming?: boolean;
  onContentResize?: () => void;
}
export function MessageTranslateButton({ messageKey, text }: MessageTranslationProps) {
  const { t } = useTranslation();
  const translation = useMessageTranslation(messageKey, text);
  return (
    <button
      type="button"
      {...{ [PARENT_HOVER_ATTR]: '' }}
      className="message-action text-muted shrink-0 rounded p-1 text-xs"
      aria-label={t('chatTranslation.translate')}
      title={t('chatTranslation.translate')}
      disabled={translation.state.loading}
      onClick={(event) => {
        event.stopPropagation();
        void translation.translate();
      }}
    >
      <Languages aria-hidden size={14} />
    </button>
  );
}
