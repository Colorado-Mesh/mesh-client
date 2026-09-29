import { ChevronDown, RadioTower } from 'lucide-react-motion';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { useToast } from './Toast';
import { Menu, menuTriggerAria, useMenuState } from './ui/Menu';

type AdvertKind = 'flood' | 'zeroHop';

interface Props {
  disabled: boolean;
  onSend: () => Promise<void>;
  /** Zero-hop advert (radios in direct range only), offered from a chevron beside Flood Advert. */
  onSendZeroHop?: () => Promise<void>;
}

const HEADER_BUTTON_CLASS =
  'text-muted hover:border-brand-green hover:text-bright-green border-ink-700 inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40';

export function MeshcoreFloodAdvertHeaderButton({ disabled, onSend, onSendZeroHop }: Props) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [sending, setSending] = useState(false);
  const { open, close, toggle, menuId } = useMenuState();
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function handleSend(kind: AdvertKind): Promise<void> {
    const send = kind === 'flood' ? onSend : onSendZeroHop;
    if (!send || disabled || sending) return;
    setSending(true);
    try {
      await send();
      addToast(
        t(kind === 'flood' ? 'radioPanel.floodAdvertSent' : 'radioPanel.zeroHopAdvertSent'),
        'success',
      );
    } catch (error) {
      const message = errLikeToLogString(error);
      const what = kind === 'flood' ? 'send' : 'zero-hop send';
      console.warn(`[MeshcoreFloodAdvertHeaderButton] ${what} failed ${message}`);
      addToast(t('radioPanel.advertFailed', { message }), 'error');
    } finally {
      setSending(false);
    }
  }

  // Disabled, the tooltips say why instead of naming an action that cannot run.
  const floodButton = (
    <button
      type="button"
      onClick={() => void handleSend('flood')}
      disabled={disabled || sending}
      aria-label={t('nodeListPanel.sendFloodAdvert')}
      aria-busy={sending}
      title={t(
        disabled ? 'nodeListPanel.sendFloodAdvertUnavailable' : 'nodeListPanel.sendFloodAdvert',
      )}
      className={onSendZeroHop ? `${HEADER_BUTTON_CLASS} rounded-r-none` : HEADER_BUTTON_CLASS}
    >
      <RadioTower
        aria-hidden
        className={`h-3.5 w-3.5 ${sending ? 'motion-status animate-pulse' : ''}`}
        size={14}
      />
      <span className="hidden xl:inline">{t('radioPanel.floodAdvertButton')}</span>
    </button>
  );
  if (!onSendZeroHop) return floodButton;

  return (
    <div
      role="group"
      aria-label={t('radioPanel.floodAdvertButton')}
      className="inline-flex shrink-0"
    >
      {floodButton}
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled || sending}
        aria-label={t('nodeListPanel.advertOptions')}
        title={t(
          disabled ? 'nodeListPanel.sendFloodAdvertUnavailable' : 'nodeListPanel.advertOptions',
        )}
        {...menuTriggerAria(open, menuId)}
        className={`${HEADER_BUTTON_CLASS} -ml-px rounded-l-none px-1`}
      >
        <ChevronDown aria-hidden className="h-3.5 w-3.5" size={14} />
      </button>
      <Menu
        id={menuId}
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        aria-label={t('nodeListPanel.advertOptions')}
        entries={[
          {
            id: 'zero-hop-advert',
            label: t('radioPanel.zeroHopAdvertButton'),
            description: t('nodeListPanel.zeroHopAdvertHint'),
            icon: <RadioTower aria-hidden className="h-4 w-4" size={16} />,
            onSelect: () => {
              void handleSend('zeroHop');
            },
          },
        ]}
      />
    </div>
  );
}
