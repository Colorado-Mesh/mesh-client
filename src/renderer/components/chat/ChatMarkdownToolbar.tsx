import { Bold, Code, Italic, Link, Strikethrough } from 'lucide-react-motion';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import {
  applyChatMarkdownWrap,
  hasChatMarkdownToolbarTarget,
  subscribeChatMarkdownToolbarTarget,
} from '@/renderer/lib/chatMarkdownToolbarTarget';
import {
  DEFAULT_FONT_SCALE,
  readAppliedFontScale,
  subscribeAppliedFontScale,
} from '@/renderer/lib/fontScale';
import { ICON_SM_PLUS } from '@/renderer/lib/icons/iconClass';

/** Design size at font scale 1; Lucide `size` is px and must track Appearance text size. */
const MARKDOWN_TOOLBAR_ICON_PX = 14;

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

export interface ChatMarkdownToolbarProps {
  /** When set, wrap this composer directly (ChatComposer). Otherwise use the registry. */
  onWrap?: (before: string, after: string) => void;
  /** When set with `onWrap`, gates buttons (same as emoji / send). */
  disabled?: boolean;
}

/**
 * Markdown formatting controls next to the chat text entry. With `onWrap`, targets that
 * composer; without it, uses `registerChatMarkdownToolbarTarget` (unit tests / fallback).
 */
export function ChatMarkdownToolbar({ onWrap, disabled = false }: ChatMarkdownToolbarProps = {}) {
  const { t } = useTranslation();
  const hasRegistryTarget = useSyncExternalStore(
    subscribeChatMarkdownToolbarTarget,
    hasChatMarkdownToolbarTarget,
    () => false,
  );
  // Lucide size is px; rem hit targets (h-6) already follow root font-size from Appearance.
  const fontScale = useSyncExternalStore(
    subscribeAppliedFontScale,
    readAppliedFontScale,
    () => DEFAULT_FONT_SCALE,
  );
  const iconSize = MARKDOWN_TOOLBAR_ICON_PX * fontScale;
  const enabled = onWrap != null ? !disabled : hasRegistryTarget;

  return (
    <div
      className="border-ink-700 inline-flex shrink-0 items-center gap-0.5 rounded border px-0.5 py-0"
      role="toolbar"
      aria-label={t('chatPanel.markdownToolbar')}
      data-testid="chat-markdown-toolbar"
    >
      {ACTIONS.map(({ id, before, after, labelKey, Icon }) => (
        <button
          key={id}
          type="button"
          className="text-muted hover:border-brand-green hover:text-bright-green inline-flex h-6 w-6 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t(labelKey)}
          title={t(labelKey)}
          disabled={!enabled}
          onMouseDown={(e) => {
            // Keep textarea selection/focus when clicking the toolbar.
            e.preventDefault();
          }}
          onClick={() => {
            if (onWrap) {
              onWrap(before, after);
              return;
            }
            applyChatMarkdownWrap(before, after);
          }}
        >
          <Icon aria-hidden className={ICON_SM_PLUS} size={iconSize} />
        </button>
      ))}
    </div>
  );
}
