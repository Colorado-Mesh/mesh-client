import { RadioTower } from 'lucide-react-motion';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { useToast } from './Toast';

interface Props {
  disabled: boolean;
  onSend: () => Promise<void>;
}

export function MeshcoreFloodAdvertHeaderButton({ disabled, onSend }: Props) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [sending, setSending] = useState(false);

  async function handleSend(): Promise<void> {
    if (disabled || sending) return;
    setSending(true);
    try {
      await onSend();
      addToast(t('radioPanel.floodAdvertSent'), 'success');
    } catch (error) {
      const message = errLikeToLogString(error);
      console.warn('[MeshcoreFloodAdvertHeaderButton] send failed ' + message);
      addToast(t('radioPanel.advertFailed', { message }), 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleSend()}
      disabled={disabled || sending}
      aria-label={t('nodeListPanel.sendFloodAdvert')}
      aria-busy={sending}
      title={t('nodeListPanel.sendFloodAdvert')}
      className="text-muted hover:border-brand-green hover:text-bright-green inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-700 px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
    >
      <RadioTower
        aria-hidden
        className={`h-3.5 w-3.5 ${sending ? 'animate-pulse' : ''}`}
        size={14}
      />
      <span className="hidden xl:inline">{t('radioPanel.floodAdvertButton')}</span>
    </button>
  );
}
