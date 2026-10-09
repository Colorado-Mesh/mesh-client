import { Languages, PARENT_HOVER_ATTR } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { useMessageTranslation } from '@/renderer/hooks/useMessageTranslation';

export interface MessageTranslationProps {
  messageKey: string;
  text: string;
  incoming?: boolean;
  onContentResize?: () => void;
}

export interface MessageTranslateButtonProps extends MessageTranslationProps {
  className?: string;
  iconSize?: number;
}

const DEFAULT_BUTTON_CLASS = 'message-action text-muted shrink-0 rounded p-1 text-xs';

export function MessageTranslateButton({
  messageKey,
  text,
  className = DEFAULT_BUTTON_CLASS,
  iconSize = 14,
}: MessageTranslateButtonProps) {
  const { t } = useTranslation();
  const translation = useMessageTranslation(messageKey, text);
  return (
    <button
      type="button"
      {...{ [PARENT_HOVER_ATTR]: '' }}
      className={className}
      aria-label={t('chatTranslation.translate')}
      title={t('chatTranslation.translate')}
      disabled={translation.state.loading}
      onClick={(event) => {
        event.stopPropagation();
        void translation.translate();
      }}
    >
      <Languages aria-hidden size={iconSize} />
    </button>
  );
}
