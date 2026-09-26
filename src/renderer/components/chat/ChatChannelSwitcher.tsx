import { ChevronDown, Hash } from 'lucide-react-motion';
import type { KeyboardEvent } from 'react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { ICON_MD, ICON_SM_PLUS } from '@/renderer/lib/icons/iconClass';
import { Z_POPOVER_MENU } from '@/renderer/lib/modalZIndex';

import { INPUT_CLASS } from '../ui/formClasses';

export interface ChatChannelOption {
  index: number;
  name: string;
}

export interface ChatChannelSwitcherProps {
  channels: readonly ChatChannelOption[];
  unreadCounts: ReadonlyMap<number, number>;
  /** Channel open in the chat, or null while a DM or the starred view is open. */
  activeIndex: number | null;
  onSelect: (index: number) => void;
}

/** Popover width in px at the default text size; rendered in rem so it grows with Text size. */
const POPOVER_WIDTH = 280;
const VIEWPORT_MARGIN = 8;

function formatUnread(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Accessible name for a channel with unread messages, matching the channel strip buttons. */
export function channelButtonLabel(name: string, unread: number): string {
  return unread > 0 ? `${name} ${formatUnread(unread)}` : name;
}

/**
 * "Channels" trigger plus a searchable list of every channel. The strip beside it scrolls in one
 * row, so a radio with dozens of channels never pushes the messages down; this list is how you
 * reach the ones scrolled out of view.
 */
export function ChatChannelSwitcher({
  channels,
  unreadCounts,
  activeIndex,
  onSelect,
}: ChatChannelSwitcherProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionIdPrefix = useId();

  const unreadElsewhere = useMemo(() => {
    let total = 0;
    for (const ch of channels) {
      if (ch.index === activeIndex) continue;
      total += unreadCounts.get(ch.index) ?? 0;
    }
    return total;
  }, [channels, unreadCounts, activeIndex]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((ch) => ch.name.toLowerCase().includes(q));
  }, [channels, query]);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setQuery('');
    setHighlight(0);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const choose = (index: number) => {
    onSelect(index);
    close(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = triggerRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = popoverRef.current?.offsetWidth || POPOVER_WIDTH;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN),
    );
    setPosition({ top: rect.bottom + 4, left });
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
      setQuery('');
      setHighlight(0);
    };
    const onResize = () => {
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const activeOption = filtered[Math.min(highlight, filtered.length - 1)];

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (filtered.length === 0 ? 0 : (h + 1) % filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) =>
        filtered.length === 0 ? 0 : (h - 1 + filtered.length) % filtered.length,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeOption) choose(activeOption.index);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  useEffect(() => {
    if (!open || !activeOption) return;
    document
      .getElementById(`${optionIdPrefix}-${activeOption.index}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeOption, optionIdPrefix]);

  const triggerLabel =
    unreadElsewhere > 0
      ? t('chatPanel.channelSwitcher.triggerWithUnread', {
          total: channels.length,
          unread: formatUnread(unreadElsewhere),
        })
      : t('chatPanel.channelSwitcher.trigger', { total: channels.length });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={() => {
          if (open) close(false);
          else setOpen(true);
        }}
        className="border-secondary-dark bg-sidebar-active-bg hover:bg-secondary-dark text-control inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 font-medium text-slate-200 transition-colors"
      >
        <Hash aria-hidden className={`${ICON_SM_PLUS} text-muted`} size={14} />
        <span className="text-meta font-mono text-slate-300 tabular-nums">{channels.length}</span>
        {unreadElsewhere > 0 && (
          <span
            aria-hidden="true"
            className="text-2xs flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 leading-none font-bold text-white"
          >
            {formatUnread(unreadElsewhere)}
          </span>
        )}
        <ChevronDown aria-hidden className={`${ICON_MD} text-muted`} size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="bg-deep-black fixed flex max-h-[min(420px,70vh)] flex-col overflow-hidden rounded-xl border border-slate-800 shadow-2xl"
            style={{
              zIndex: Z_POPOVER_MENU,
              width: `${POPOVER_WIDTH / 16}rem`,
              maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
            }}
          >
            <div className="border-b border-slate-800 p-2">
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={
                  activeOption ? `${optionIdPrefix}-${activeOption.index}` : undefined
                }
                aria-label={t('chatPanel.channelSwitcher.search')}
                placeholder={t('chatPanel.channelSwitcher.search')}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={handleKeyDown}
                className={INPUT_CLASS}
              />
            </div>
            <div
              id={listId}
              role="listbox"
              aria-label={t('chatPanel.channelSwitcher.listLabel')}
              className="min-h-0 flex-1 overflow-y-auto p-1"
            >
              {filtered.length === 0 ? (
                <p className="text-muted px-2.5 py-3 text-center text-xs">
                  {t('chatPanel.channelSwitcher.empty')}
                </p>
              ) : (
                filtered.map((ch) => {
                  const unread = ch.index === activeIndex ? 0 : (unreadCounts.get(ch.index) ?? 0);
                  const highlighted = ch.index === activeOption?.index;
                  const selected = ch.index === activeIndex;
                  return (
                    <div
                      key={ch.index}
                      id={`${optionIdPrefix}-${ch.index}`}
                      role="option"
                      aria-selected={selected}
                      aria-label={channelButtonLabel(ch.name, unread)}
                      tabIndex={-1}
                      onPointerMove={() => {
                        const i = filtered.indexOf(ch);
                        if (i >= 0 && i !== highlight) setHighlight(i);
                      }}
                      onClick={() => {
                        choose(ch.index);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          choose(ch.index);
                        }
                      }}
                      className={`text-body flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2.5 ${
                        highlighted ? 'bg-sidebar-active-bg text-slate-100' : 'text-slate-300'
                      }`}
                    >
                      <span className="text-muted text-label w-6 shrink-0 font-mono tabular-nums">
                        {ch.index}
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate ${selected ? 'text-bright-green font-medium' : ''}`}
                      >
                        {ch.name}
                      </span>
                      {unread > 0 && (
                        <span className="text-2xs flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 leading-none font-bold text-white">
                          {formatUnread(unread)}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
