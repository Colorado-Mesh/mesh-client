import { Bold, Code, Italic, Link, Strikethrough } from 'lucide-react-motion';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import {
  applyChatMarkdownWrap,
  hasChatMarkdownToolbarTarget,
  subscribeChatMarkdownToolbarTarget,
} from '@/renderer/lib/chatMarkdownToolbarTarget';
import { ICON_MD } from '@/renderer/lib/icons/iconClass';

const ACTIONS = [
  { id: 'bold', before: '**', after: '**', labelKey: 'chatPanel.markdownBold', Icon: Bold },
  { id: 'italic', before: '*', after: '*', labelKey: 'chatPanel.markdownItalic', Icon: Italic },
  {
    id: 'strike',
    before: '~~',
    after: '~~',
    labelKey: 'chatPanel.markdownStrike',
    Icon: Strikethrough,
  },
  { id: 'code', before: '`', after: '`', labelKey: 'chatPanel.markdownCode', Icon: Code },
  {
    id: 'link',
    before: '[',
    after: '](https://)',
    labelKey: 'chatPanel.markdownLink',
    Icon: Link,
  },
] as const;

/**
 * Fixed header formatting controls (icons + tooltips). Targets the active ChatComposer via
 * `registerChatMarkdownToolbarTarget` so macro size changes cannot reflow these buttons.
 */
export function ChatMarkdownToolbar() {
  const { t } = useTranslation();
  const enabled = useSyncExternalStore(
    subscribeChatMarkdownToolbarTarget,
    hasChatMarkdownToolbarTarget,
    () => false,
  );

  return (
    <div
      className="border-ink-700 inline-flex shrink-0 items-center gap-0.5 rounded border px-1 py-0.5"
      role="toolbar"
      aria-label={t('chatPanel.markdownToolbar')}
      data-testid="chat-markdown-toolbar"
    >
      {ACTIONS.map(({ id, before, after, labelKey, Icon }) => (
        <button
          key={id}
          type="button"
          className="text-muted hover:border-brand-green hover:text-bright-green inline-flex h-7 w-7 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t(labelKey)}
          title={t(labelKey)}
          disabled={!enabled}
          onClick={() => {
            applyChatMarkdownWrap(before, after);
          }}
        >
          <Icon aria-hidden className={ICON_MD} size={16} />
        </button>
      ))}
    </div>
  );
}
