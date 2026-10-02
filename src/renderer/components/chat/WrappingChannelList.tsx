import { type ReactNode, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface WrappingChannelListProps {
  activeKey: number | null;
  children: ReactNode;
}

/** Wrapped channels scroll only when the chat header runs out of vertical space. */
export function WrappingChannelList({ activeKey, children }: WrappingChannelListProps) {
  const { t } = useTranslation();
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [hiddenUnread, setHiddenUnread] = useState({ above: 0, below: 0 });

  const unreadOutside = useCallback(() => {
    const viewport = viewportRef.current;
    const bounds = viewport?.getBoundingClientRect();
    const above: HTMLButtonElement[] = [];
    const below: HTMLButtonElement[] = [];
    if (viewport && bounds) {
      for (const button of viewport.querySelectorAll<HTMLButtonElement>(
        'button[data-channel-unread]',
      )) {
        if (Number(button.dataset.channelUnread) <= 0) continue;
        const marker = button.querySelector<HTMLElement>('[data-chip-unread]') ?? button;
        const box = marker.getBoundingClientRect();
        if (box.top < bounds.top - 1) above.push(button);
        if (box.bottom > bounds.bottom + 1) below.push(button);
      }
    }
    return { above, below };
  }, []);

  const measure = useCallback(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    setOverflow(!!root && !!content && content.scrollHeight > root.clientHeight + 1);
    const { above, below } = unreadOutside();
    setHiddenUnread((previous) =>
      previous.above === above.length && previous.below === below.length
        ? previous
        : { above: above.length, below: below.length },
    );
  }, [unreadOutside]);

  const reveal = useCallback(
    (button: HTMLElement) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const bounds = viewport.getBoundingClientRect();
      const box = button.getBoundingClientRect();
      if (box.height > viewport.clientHeight - 8) viewport.scrollTop += box.top - bounds.top - 4;
      else if (box.top < bounds.top) viewport.scrollTop -= bounds.top - box.top + 4;
      else if (box.bottom > bounds.bottom) viewport.scrollTop += box.bottom - bounds.bottom + 4;
      measure();
    },
    [measure],
  );

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      measure();
      const focused = document.activeElement;
      if (focused instanceof HTMLButtonElement && contentRef.current?.contains(focused)) {
        reveal(focused);
      } else if (activeKey != null) {
        const active = contentRef.current?.querySelector<HTMLElement>('[data-strip-active="true"]');
        if (active) reveal(active);
      }
    });
    if (rootRef.current) observer.observe(rootRef.current);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => {
      observer.disconnect();
    };
  }, [activeKey, children, measure, reveal]);

  useLayoutEffect(() => {
    if (activeKey == null) return;
    const button = viewportRef.current?.querySelector<HTMLElement>('[data-strip-active="true"]');
    if (button) reveal(button);
  }, [activeKey, reveal]);

  function showUnread(direction: 'above' | 'below') {
    const buttons = unreadOutside()[direction];
    const button = direction === 'above' ? buttons.at(-1) : buttons[0];
    if (!button) return;
    button.focus({ preventScroll: true });
    reveal(button.querySelector<HTMLElement>('[data-chip-unread]') ?? button);
  }

  /* eslint-disable jsx-a11y/no-noninteractive-tabindex -- A named overflow region needs keyboard focus for native scrolling. */
  return (
    <div ref={rootRef} className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div
        id={id}
        ref={viewportRef}
        role="region"
        aria-label={t('chatPanel.channels')}
        tabIndex={overflow ? 0 : undefined}
        onScroll={measure}
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLButtonElement) reveal(event.target);
        }}
        className="rounded-control focus-visible:outline-brand-green min-h-0 overflow-y-auto overscroll-contain focus-visible:outline-2"
      >
        <div ref={contentRef} className="flex min-w-0 flex-wrap items-center gap-1 p-0.5">
          {children}
        </div>
      </div>
      {overflow && (
        <div className="text-muted text-label flex shrink-0 flex-wrap items-center justify-between gap-x-2">
          {hiddenUnread.above === 0 && hiddenUnread.below === 0 && (
            <span>{t('chatPanel.scrollChannels')}</span>
          )}
          {(hiddenUnread.above > 0 || hiddenUnread.below > 0) && (
            <span>{t('chatPanel.hiddenUnreadChannels')}</span>
          )}
          {(['above', 'below'] as const).map((direction) =>
            hiddenUnread[direction] > 0 ? (
              <button
                key={direction}
                type="button"
                aria-controls={id}
                aria-label={t(
                  direction === 'above'
                    ? 'chatPanel.unreadChannelsAbove'
                    : 'chatPanel.unreadChannelsBelow',
                  { count: hiddenUnread[direction] },
                )}
                className="hover:text-ink-100 rounded-control focus-visible:outline-brand-green min-h-6 px-1 focus-visible:outline-2"
                onClick={() => {
                  showUnread(direction);
                }}
              >
                <span aria-hidden="true">
                  {direction === 'above' ? '↑ ' : '↓ '}
                  {hiddenUnread[direction]}
                </span>
              </button>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-tabindex */
}
