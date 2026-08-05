/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual useVirtualizer; same as RoomsPanel */
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, Copy } from 'lucide-react-motion';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import MentionAutocomplete from '@/renderer/components/MentionAutocomplete';
import { isSafeChatUrl } from '@/renderer/lib/chatMentionSegments';
import {
  CHAT_SCROLL_END_THRESHOLD,
  createChatScrollAdjustPredicate,
  createStableChatMeasureElement,
  getDistFromChatBottom,
  VIRTUALIZER_SCROLL_END_THRESHOLD,
} from '@/renderer/lib/chatScrollUtils';
import { formatDisplayTime } from '@/renderer/lib/formatDisplayTime';
import { bodyMentionsRrcNick, findNextRrcNickMention } from '@/renderer/lib/rrcMention';
import { parseRrcWhisperEcho, shouldDisplayRrcChatMessage } from '@/renderer/lib/rrcMessageDisplay';
import { rrcNickColorClass } from '@/renderer/lib/rrcNickColor';
import {
  findRrcAtMentionAtCaret,
  insertRrcNickMention,
  listRrcNickCompleteCandidates,
  nextRrcNickCompleteIndex,
  rrcMemberNickLabels,
} from '@/renderer/lib/rrcNickComplete';
import { useTimeFormatStore } from '@/renderer/stores/timeFormatStore';
import type { RrcChatMessage, RrcRoomMember } from '@/shared/rrc-types';

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

const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gu;
const TRAILING_PUNCT = /[.,!?;:'"()]+$/;

/** Inline URL + plain text segments (no block wrappers — keeps IRC one-liners). */
function renderRrcInlineText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  URL_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_PATTERN.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(
        <span key={`${keyPrefix}-t-${last}`} className="whitespace-pre-wrap">
          {text.slice(last, m.index)}
        </span>,
      );
    }
    const raw = m[0];
    const url = raw.replace(TRAILING_PUNCT, '');
    if (isSafeChatUrl(url)) {
      nodes.push(
        <a
          key={`${keyPrefix}-u-${m.index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-cyan-400 underline hover:text-cyan-300"
        >
          {url}
        </a>,
      );
    } else {
      nodes.push(
        <span key={`${keyPrefix}-u-${m.index}`} className="whitespace-pre-wrap">
          {url}
        </span>,
      );
    }
    if (raw.length > url.length) {
      nodes.push(
        <span key={`${keyPrefix}-p-${m.index}`} className="whitespace-pre-wrap">
          {raw.slice(url.length)}
        </span>,
      );
    }
    last = m.index + raw.length;
  }
  if (last < text.length) {
    nodes.push(
      <span key={`${keyPrefix}-t-${last}`} className="whitespace-pre-wrap">
        {text.slice(last)}
      </span>,
    );
  }
  return nodes;
}

/** Highlight IRC-style @nick tokens that match the local nickname (inline only). */
function highlightRrcSelfMentions(text: string, nickname: string): ReactNode {
  const nick = nickname.trim();
  if (!nick || !bodyMentionsRrcNick(text, nick)) {
    return <>{renderRrcInlineText(text, 'b')}</>;
  }
  const nodes: ReactNode[] = [];
  let last = 0;
  let cursor = 0;
  let match = findNextRrcNickMention(text, nick, cursor);
  while (match) {
    if (match.start > last) {
      nodes.push(...renderRrcInlineText(text.slice(last, match.start), `t${last}`));
    }
    nodes.push(
      <mark
        key={`m-${match.start}`}
        className="rounded bg-yellow-400/50 px-0.5 font-semibold text-yellow-950"
      >
        {text.slice(match.start, match.end)}
      </mark>,
    );
    last = match.end;
    cursor = match.end;
    match = findNextRrcNickMention(text, nick, cursor);
  }
  if (last < text.length) {
    nodes.push(...renderRrcInlineText(text.slice(last), `t${last}`));
  }
  return nodes.length > 0 ? <>{nodes}</> : null;
}

function NickSpan({ nick }: { nick: string }) {
  if (!nick) return null;
  return <span className={`font-semibold ${rrcNickColorClass(nick)}`}>{nick}</span>;
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
  /** Active room members for @ / Tab nick completion. */
  members?: RrcRoomMember[];
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
  members = [],
  alwaysShowMessageActions = false,
  placeholder,
  isActive = true,
}: RrcChatViewProps) {
  const { t } = useTranslation();
  const use24HourTime = useTimeFormatStore((s) => s.use24HourTime);
  const composerPlaceholder = placeholder ?? t('rrc.messagePlaceholder');

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Sticky intent: user is reading latest messages and wants auto-follow on new traffic. */
  const isPinnedToBottomRef = useRef(true);
  const unreadStartIndexRef = useRef(-1);
  const savedScrollTopRef = useRef<number | null>(null);
  const savedWasPinnedToBottomRef = useRef(false);
  const wasActiveRef = useRef(isActive);
  const prevActiveRoomRef = useRef(activeRoom);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionTriggerPos, setMentionTriggerPos] = useState(0);
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);
  const [tabCycleIndex, setTabCycleIndex] = useState(-1);

  const visibleMessages = useMemo(() => messages.filter(shouldDisplayRrcChatMessage), [messages]);

  const nickLabels = useMemo(() => rrcMemberNickLabels(members), [members]);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery == null) return [];
    return listRrcNickCompleteCandidates(nickLabels, mentionQuery).map((name, i) => ({
      nodeId: i,
      name,
    }));
  }, [mentionQuery, nickLabels]);

  const syncMentionFromCaret = useCallback((value: string, caret: number) => {
    const at = findRrcAtMentionAtCaret(value, caret);
    if (!at) {
      setMentionQuery(null);
      setTabCycleIndex(-1);
      return;
    }
    setMentionTriggerPos(at.start);
    setMentionQuery(at.query);
    setMentionSelectedIdx(0);
    setTabCycleIndex(-1);
  }, []);

  const insertMention = useCallback(
    (name: string) => {
      const queryLen = mentionQuery?.length ?? 0;
      const { text, caret } = insertRrcNickMention(draft, mentionTriggerPos, queryLen, name);
      onDraftChange(text);
      setMentionQuery(null);
      setTabCycleIndex(-1);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(caret, caret);
      });
    },
    [draft, mentionQuery, mentionTriggerPos, onDraftChange],
  );

  const estimateSize = useCallback(
    (index: number) => estimateRrcRowHeight(visibleMessages[index]),
    [visibleMessages],
  );

  const measureElement = useMemo(
    () => createStableChatMeasureElement(estimateSize),
    [estimateSize],
  );

  const messageVirtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize,
    measureElement,
    overscan: 10,
    getItemKey: (index) => rrcMessageVirtualizerKey(visibleMessages[index], index),
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
  }, [visibleMessages.length, isActive, activeRoom, updateScrollButtonVisibility]);

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

  const handleComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery != null && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionSelectedIdx((i) => Math.min(i + 1, mentionCandidates.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        setTabCycleIndex(-1);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const candidate = mentionCandidates[mentionSelectedIdx];
        if (candidate) insertMention(candidate.name);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const names = mentionCandidates.map((c) => c.name);
        const nextIdx = nextRrcNickCompleteIndex(names, tabCycleIndex, e.shiftKey);
        if (nextIdx < 0) return;
        const nick = names[nextIdx];
        if (!nick) return;
        setTabCycleIndex(nextIdx);
        setMentionSelectedIdx(nextIdx);
        const { text, caret } = insertRrcNickMention(
          draft,
          mentionTriggerPos,
          mentionQuery.length,
          nick,
        );
        onDraftChange(text);
        // Keep dropdown open for further Tab cycles (query = completed nick).
        setMentionQuery(nick);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(caret, caret);
        });
        return;
      }
    } else if (e.key === 'Tab') {
      const el = e.currentTarget;
      const caret = el.selectionStart ?? draft.length;
      const at = findRrcAtMentionAtCaret(draft, caret);
      if (at) {
        e.preventDefault();
        const candidates = listRrcNickCompleteCandidates(nickLabels, at.query);
        if (candidates.length === 0) return;
        const nextIdx = nextRrcNickCompleteIndex(candidates, -1, e.shiftKey);
        const nick = candidates[nextIdx];
        if (!nick) return;
        setMentionTriggerPos(at.start);
        setMentionQuery(at.query);
        setTabCycleIndex(nextIdx);
        setMentionSelectedIdx(nextIdx);
        const { text, caret: newCaret } = insertRrcNickMention(
          draft,
          at.start,
          at.query.length,
          nick,
        );
        onDraftChange(text);
        setMentionQuery(nick);
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(newCaret, newCaret);
        });
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      setMentionQuery(null);
      onSend(draft);
    }
  };

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
                const msg = visibleMessages[vi.index];
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
                const whisperEcho = msg.kind === 'system' ? parseRrcWhisperEcho(msg.body) : null;
                const body = highlightRrcSelfMentions(
                  whisperEcho ? whisperEcho.text : msg.body,
                  nickname,
                );

                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    data-testid="rrc-chat-line"
                    ref={messageVirtualizer.measureElement}
                    className={`absolute top-0 left-0 w-full ${lineClass}`}
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    <div className="group flex items-start gap-1 leading-snug">
                      {time && (
                        <span className="shrink-0 text-[10px] text-amber-200/35">[{time}]</span>
                      )}
                      <div className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                        {whisperEcho ? (
                          <>
                            → <NickSpan nick={whisperEcho.name} />: {body}
                          </>
                        ) : msg.kind === 'action' ? (
                          <>
                            * <NickSpan nick={nick} /> {body}
                          </>
                        ) : msg.kind === 'notice' ||
                          msg.kind === 'system' ||
                          msg.kind === 'error' ? (
                          <>
                            {msg.kind === 'notice' && nick ? (
                              <span className={rrcNickColorClass(nick)}>-{nick}- </span>
                            ) : (
                              <span className="text-amber-500/70">* </span>
                            )}
                            {body}
                          </>
                        ) : (
                          <>
                            <span className={`font-semibold ${rrcNickColorClass(nick)}`}>
                              &lt;{nick}&gt;
                            </span>{' '}
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
      <div className="relative flex gap-2 border-t border-amber-800/40 p-2">
        {mentionQuery != null && mentionCandidates.length > 0 && (
          <MentionAutocomplete
            candidates={mentionCandidates}
            selectedIdx={mentionSelectedIdx}
            onSelect={insertMention}
            onSetSelectedIdx={setMentionSelectedIdx}
          />
        )}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            const value = e.target.value;
            onDraftChange(value);
            syncMentionFromCaret(value, e.target.selectionStart ?? value.length);
          }}
          onSelect={(e) => {
            const el = e.currentTarget;
            syncMentionFromCaret(el.value, el.selectionStart ?? el.value.length);
          }}
          onKeyDown={handleComposerKeyDown}
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
