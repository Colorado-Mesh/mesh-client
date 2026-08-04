/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual useVirtualizer; same as RoomsPanel */
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, Copy } from 'lucide-react-motion';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { ChatPayloadText } from '@/renderer/components/ChatPayloadText';
import {
  CHAT_SCROLL_END_THRESHOLD,
  createChatScrollAdjustPredicate,
  createStableChatMeasureElement,
  getDistFromChatBottom,
  VIRTUALIZER_SCROLL_END_THRESHOLD,
} from '@/renderer/lib/chatScrollUtils';
import { formatDisplayTime } from '@/renderer/lib/formatDisplayTime';
import { bodyMentionsRrcNick, findNextRrcNickMention } from '@/renderer/lib/rrcMention';
import { useTimeFormatStore } from '@/renderer/stores/timeFormatStore';
import type { RrcChatMessage } from '@/shared/rrc-types';

function formatHash(hash: string): string {
  return hash.slice(0, 8);
}

/** Compact IRC line height for virtualization (not ChatMessage card estimates). */
export function estimateRrcRowHeight(msg: RrcChatMessage | null | undefined): number {
  const bodyLen = msg?.body.length ?? 0;
  const lines = Math.max(1, Math.ceil(bodyLen / 80));
  // ~20px leading-snug + 2px row gap
  return lines * 20 + 2;
}

function rrcMessageVirtualizerKey(msg: RrcChatMessage | null | undefined, index: number): string {
  if (!msg) return `rrc-slot-${index}`;
  return msg.id || `rrc-slot-${index}`;
}

/** Highlight IRC-style @nick tokens that match the local nickname. */
function highlightRrcSelfMentions(text: string, nickname: string): ReactNode {
  const nick = nickname.trim();
  if (!nick || !bodyMentionsRrcNick(text, nick)) {
    return <ChatPayloadText text={text} query="" loadLinkPreviews={false} />;
  }
  const nodes: ReactNode[] = [];
  let last = 0;
  let cursor = 0;
  let match = findNextRrcNickMention(text, nick, cursor);
  while (match) {
    if (match.start > last) {
      nodes.push(
        <ChatPayloadText
          key={`t-${last}`}
          text={text.slice(last, match.start)}
          query=""
          loadLinkPreviews={false}
        />,
      );
    }
    nodes.push(
      <mark key={`m-${match.start}`} className="rounded bg-amber-500/35 px-0.5 text-amber-100">
        {text.slice(match.start, match.end)}
      </mark>,
    );
    last = match.end;
    cursor = match.end;
    match = findNextRrcNickMention(text, nick, cursor);
  }
  if (last < text.length) {
    nodes.push(
      <ChatPayloadText
        key={`t-${last}`}
        text={text.slice(last)}
        query=""
        loadLinkPreviews={false}
      />,
    );
  }
  return nodes.length > 0 ? (
    <>{nodes}</>
  ) : (
    <ChatPayloadText text={text} query="" loadLinkPreviews={false} />
  );
}

export interface RrcChatViewProps {
  connected: boolean;
  activeRoom: string | null;
  messages: RrcChatMessage[];
  showTimestamps: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: (text: string) => void;
  canSend: boolean;
  isMuted: boolean;
  /** Local session nick — used to highlight @mentions of self. */
  nickname?: string;
  /** Keep the per-message copy control visible (same App Appearance setting as Chat). */
  alwaysShowMessageActions?: boolean;
  /** Composer placeholder override (e.g. whisper reply hint). */
  placeholder?: string;
  /** When false, skip follow-on-append and snapshot scroll for tab restore. */
  isActive?: boolean;
}

export function RrcChatView({
  connected,
  activeRoom,
  messages,
  showTimestamps,
  draft,
  onDraftChange,
  onSend,
  canSend,
  isMuted,
  nickname = '',
  alwaysShowMessageActions = false,
  placeholder,
  isActive = true,
}: RrcChatViewProps) {
  const { t } = useTranslation();
  const use24HourTime = useTimeFormatStore((s) => s.use24HourTime);
  const composerPlaceholder = placeholder ?? t('rrc.messagePlaceholder');

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** Sticky intent: user is reading latest messages and wants auto-follow on new traffic. */
  const isPinnedToBottomRef = useRef(true);
  const unreadStartIndexRef = useRef(-1);
  const savedScrollTopRef = useRef<number | null>(null);
  const savedWasPinnedToBottomRef = useRef(false);
  const wasActiveRef = useRef(isActive);
  const prevActiveRoomRef = useRef(activeRoom);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const estimateSize = useCallback(
    (index: number) => estimateRrcRowHeight(messages[index]),
    [messages],
  );

  const measureElement = useMemo(
    () => createStableChatMeasureElement(estimateSize),
    [estimateSize],
  );

  const messageVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize,
    measureElement,
    overscan: 10,
    getItemKey: (index) => rrcMessageVirtualizerKey(messages[index], index),
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: VIRTUALIZER_SCROLL_END_THRESHOLD,
  });

  messageVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = createChatScrollAdjustPredicate({
    unreadStartIndexRef,
    isPinnedToBottomRef,
  });

  const messageVirtualizerRef = useRef(messageVirtualizer);
  messageVirtualizerRef.current = messageVirtualizer;

  const computeIsAtChatEnd = useCallback(() => {
    if (!scrollContainerRef.current) return false;
    return messageVirtualizerRef.current.isAtEnd(CHAT_SCROLL_END_THRESHOLD);
  }, []);

  const updateScrollButtonVisibility = useCallback(() => {
    const atEnd = computeIsAtChatEnd();
    isPinnedToBottomRef.current = atEnd;
    setShowScrollButton(!atEnd);
    return getDistFromChatBottom(scrollContainerRef.current, messagesEndRef.current, null);
  }, [computeIsAtChatEnd]);

  const handleStreamScroll = useCallback(() => {
    updateScrollButtonVisibility();
  }, [updateScrollButtonVisibility]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    messageVirtualizerRef.current.scrollToEnd({ behavior });
    isPinnedToBottomRef.current = true;
    setShowScrollButton(false);
  }, []);

  // Follow new messages when pinned (Rooms/Chat contract).
  useEffect(() => {
    if (!isActive || document.hidden || !activeRoom) return;
    if (isPinnedToBottomRef.current) {
      messageVirtualizerRef.current.scrollToEnd();
    }
    requestAnimationFrame(() => {
      updateScrollButtonVisibility();
    });
  }, [messages.length, isActive, activeRoom, updateScrollButtonVisibility]);

  // Room switch while active → pin + scroll to end.
  useLayoutEffect(() => {
    const prevRoom = prevActiveRoomRef.current;
    prevActiveRoomRef.current = activeRoom;
    if (!isActive) return;
    if (prevRoom === activeRoom) return;
    if (!activeRoom) return;
    isPinnedToBottomRef.current = true;
    messageVirtualizerRef.current.scrollToEnd();
    setShowScrollButton(false);
  }, [activeRoom, isActive]);

  // Tab exit snapshot / tab return restore (Rooms contract).
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isActive;

    if (!isActive) {
      if (el) {
        savedScrollTopRef.current = el.scrollTop;
        savedWasPinnedToBottomRef.current = isPinnedToBottomRef.current;
      }
      return;
    }

    if (!wasActive) {
      if (savedScrollTopRef.current !== null) {
        if (savedWasPinnedToBottomRef.current) {
          messageVirtualizerRef.current.scrollToEnd();
          isPinnedToBottomRef.current = true;
          setShowScrollButton(false);
        } else if (el) {
          el.scrollTop = savedScrollTopRef.current;
        }
        savedScrollTopRef.current = null;
        savedWasPinnedToBottomRef.current = false;
      }
    }
  }, [isActive]);

  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      updateScrollButtonVisibility();
    });
  }, [updateScrollButtonVisibility]);

  if (!connected) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-amber-200/50">
        {t('rrc.selectHubPrompt')}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col font-mono text-[13px]">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollContainerRef}
          data-testid="rrc-message-stream"
          onScroll={handleStreamScroll}
          className="h-full overflow-y-auto px-3 py-2"
        >
          {!activeRoom && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-amber-200/50">
              <p>{t('rrc.joinRoomPrompt')}</p>
              <p className="max-w-md text-xs text-amber-200/40">{t('rrc.joinRoomHelp')}</p>
            </div>
          )}
          {activeRoom && (
            <div
              ref={messageVirtualizer.containerRef}
              className="relative w-full"
              style={{ height: `${messageVirtualizer.getTotalSize()}px` }}
            >
              {messageVirtualizer.getVirtualItems().map((vi) => {
                const msg = messages[vi.index];
                if (!msg) return null;
                const nick = msg.nickname || (msg.sender_hash ? formatHash(msg.sender_hash) : '');
                const time = showTimestamps
                  ? formatDisplayTime(msg.timestamp, {
                      withSeconds: true,
                      use24Hour: use24HourTime,
                    })
                  : null;
                const lineClass =
                  msg.kind === 'notice' || msg.kind === 'system'
                    ? 'text-amber-300/90'
                    : msg.kind === 'action'
                      ? 'text-cyan-200/90 italic'
                      : msg.kind === 'error'
                        ? 'text-red-300'
                        : 'text-amber-50/90';
                const body = highlightRrcSelfMentions(msg.body, nickname);

                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={messageVirtualizer.measureElement}
                    className={`absolute top-0 left-0 w-full ${lineClass}`}
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    <div className="group flex items-start gap-1 leading-snug">
                      {time && (
                        <span className="shrink-0 text-[10px] text-amber-200/35">[{time}]</span>
                      )}
                      <div className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                        {msg.kind === 'action' ? (
                          <>
                            * {nick} {body}
                          </>
                        ) : msg.kind === 'notice' ||
                          msg.kind === 'system' ||
                          msg.kind === 'error' ? (
                          <>
                            {msg.kind === 'notice' && nick ? (
                              <span className="text-amber-400/80">-{nick}- </span>
                            ) : (
                              <span className="text-amber-500/70">* </span>
                            )}
                            {body}
                          </>
                        ) : (
                          <>
                            <span className="font-semibold text-amber-200">&lt;{nick}&gt;</span>{' '}
                            {body}
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        className={`shrink-0 p-0.5 text-amber-200/20 hover:text-amber-100 ${
                          alwaysShowMessageActions
                            ? 'opacity-100'
                            : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
                        }`}
                        aria-label={t('rrc.copyMessage')}
                        title={t('rrc.copyMessage')}
                        onClick={() => {
                          void navigator.clipboard.writeText(msg.body).catch((e: unknown) => {
                            console.debug('[RrcChatView] clipboard ' + String(e));
                          });
                        }}
                      >
                        <Copy size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        {showScrollButton && activeRoom && (
          <button
            type="button"
            onClick={() => {
              scrollToBottom('smooth');
            }}
            className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-amber-800/60 bg-slate-900/95 px-3 py-1.5 text-xs font-medium text-amber-100 shadow-lg transition-all hover:bg-slate-800"
            aria-label={t('rrc.jumpToLatest')}
          >
            <ArrowDown aria-hidden className="h-3.5 w-3.5" size={14} />
            {t('rrc.jumpToLatest')}
          </button>
        )}
      </div>
      <div className="flex gap-2 border-t border-amber-800/40 p-2">
        <textarea
          value={draft}
          onChange={(e) => {
            onDraftChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend(draft);
            }
          }}
          disabled={!canSend || isMuted}
          placeholder={composerPlaceholder}
          aria-label={composerPlaceholder}
          rows={2}
          className="min-w-0 flex-1 resize-none rounded border border-amber-800/50 bg-slate-900/80 px-2 py-1.5 font-sans text-sm text-amber-50 disabled:opacity-50"
        />
        <button
          type="button"
          className="self-end rounded bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          aria-label={t('rrc.send')}
          disabled={!canSend || isMuted || !draft.trim()}
          onClick={() => {
            onSend(draft);
          }}
        >
          {t('rrc.send')}
        </button>
      </div>
    </div>
  );
}
