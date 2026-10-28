import { RefreshCw } from 'lucide-react-motion';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { HelpTooltip } from '../HelpTooltip';
import { useToast } from '../Toast';
import { IconButton } from '../ui/Button';

export function RadioChatSyncButton({
  onSync,
  disabled,
  feedback = 'inline',
}: {
  onSync: () => Promise<void>;
  disabled: boolean;
  feedback?: 'inline' | 'toast';
}) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'done' | 'failed' | null>(null);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <HelpTooltip text={t(busy ? 'radioChatSync.busy' : 'radioChatSync.sync')} nonFocusableWrapper>
        <IconButton
          size="sm"
          aria-label={t(busy ? 'radioChatSync.busy' : 'radioChatSync.sync')}
          disabled={disabled || busy}
          aria-busy={busy}
          icon={<RefreshCw aria-hidden size={16} className={busy ? 'animate-spin' : ''} />}
          onClick={() => {
            setBusy(true);
            setResult(null);
            void onSync()
              .then(() => {
                if (feedback === 'toast') addToast(t('radioChatSync.done'), 'success');
                setResult('done');
              })
              .catch((error: unknown) => {
                console.warn('[RadioChatSyncButton] sync failed ' + errLikeToLogString(error));
                if (feedback === 'toast') addToast(t('radioChatSync.failed'), 'error');
                setResult('failed');
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        />
      </HelpTooltip>
      {result && (
        <span
          role={result === 'failed' ? 'alert' : 'status'}
          className={
            feedback === 'toast'
              ? 'sr-only'
              : `max-w-56 text-xs ${result === 'failed' ? 'text-red-400' : 'text-muted'}`
          }
        >
          {t(result === 'failed' ? 'radioChatSync.failed' : 'radioChatSync.done')}
        </span>
      )}
    </div>
  );
}
