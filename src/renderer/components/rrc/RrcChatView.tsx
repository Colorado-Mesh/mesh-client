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

import { ChatComposer } from '@/renderer/components/ChatComposer';
import { ConfirmModal } from '@/renderer/components/ConfirmModal';
import { RrcFormattedBody } from '@/renderer/components/rrc/RrcFormattedBody';
import { useAppWindowActivity } from '@/renderer/lib/appWindowActivity';
import { isSafeChatUrl } from '@/renderer/lib/chatMentionSegments';
import {
  CHAT_SCROLL_END_THRESHOLD,
  createChatScrollAdjustPredicate,
  createStableChatMeasureElement,
  getDistFromChatBottom,
  VIRTUALIZER_SCROLL_END_THRESHOLD,
} from '@/renderer/lib/chatScrollUtils';
import { readAppliedFontScale, subscribeAppliedFontScale } from '@/renderer/lib/fontScale';
import { formatDisplayTime } from '@/renderer/lib/formatDisplayTime';
import { openNomadPageFromLink } from '@/renderer/lib/nomad/openNomadPageFromLink';
import {
  findReticulumChatLinks,
  type ReticulumChatLink,
} from '@/renderer/lib/nomad/reticulumLinkText';
import { resolveRrcMsgBodyLimit, rrcComposerBypassesSplit } from '@/renderer/lib/rrcHubLimits';
import {
  bodyMentionsRrcNick,
  findNextRrcNickMention,
  isRrcWhisperRoom,
} from '@/renderer/lib/rrcMention';
import { parseRrcWhisperEcho, shouldDisplayRrcChatMessage } from '@/renderer/lib/rrcMessageDisplay';
import { rrcNickColorClass } from '@/renderer/lib/rrcNickColor';
import {
  findRrcAtMentionAtCaret,
  listRrcNickCompleteCandidates,
  rrcMemberNickLabels,
} from '@/renderer/lib/rrcNickComplete';
import { useTimeFormatStore } from '@/renderer/stores/timeFormatStore';
import type { RrcChatMessage, RrcRoomMember } from '@/shared/rrc-types';

function formatHash(hash: string): string {
  return hash.slice(0, 8);
}

/** Compact IRC line height at 100% font scale: ~20px leading-snug + 2px row gap. */
const RRC_ROW_LINE_PX = 20;
const RRC_ROW_GAP_PX = 2;
/** Characters per wrapped line at 100% font scale. */
const RRC_ROW_CHARS_PER_LINE = 80;

/**
 * Compact IRC line height for virtualization (not ChatMessage card estimates).
 * Scales with the user's font size: taller lines that fit fewer characters.
 * Only an estimate — the virtualizer measures real rows once they render.
 */
export function estimateRrcRowHeight(msg: RrcChatMessage | null | undefined): number {
  const scale = readAppliedFontScale();
  const bodyLen = msg?.body.length ?? 0;
  const charsPerLine = Math.max(1, Math.round(RRC_ROW_CHARS_PER_LINE / scale));
  const lines = Math.max(1, Math.ceil(bodyLen / charsPerLine));
  return Math.round(lines * RRC_ROW_LINE_PX * scale + RRC_ROW_GAP_PX);
}

function rrcMessageVirtualizerKey(msg: RrcChatMessage | null | undefined, index: number): string {
  if (!msg) return `rrc-slot-${index}`;
  return msg.id || `rrc-slot-${index}`;
}

const EMPTY_RRC_MEMBERS: readonly RrcRoomMember[] = Object.freeze([]);

const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gu;
const TRAILING_PUNCT = /[.,!?;:'"()]+$/;

const RRC_LINK_CLASS = 'break-all text-cyan-400 underline hover:text-cyan-300 align-baseline';

interface RrcHttpSegment {
  kind: 'http';
  start: number;
  end: number;
  url: string;
  trailing: string;
}

type RrcLinkSegment = RrcHttpSegment | ReticulumChatLink;

function findRrcHttpLinks(text: string): RrcHttpSegment[] {
  const found: RrcHttpSegment[] = [];
  URL_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_PATTERN.exec(text)) !== null) {
    const raw = m[0];
    const url = raw.replace(TRAILING_PUNCT, '');
    found.push({
      kind: 'http',
      start: m.index,
      end: m.index + raw.length,
      url,
      trailing: raw.slice(url.length),
    });
  }
  return found;
}

/** Merge http and Reticulum matches by position; http wins on any overlap. */
function findRrcLinkSegments(text: string): RrcLinkSegment[] {
  const http = findRrcHttpLinks(text);
  const reticulum = findReticulumChatLinks(text).filter(
    (link) => !http.some((h) => link.start < h.end && h.start < link.end),
  );
  return [...http, ...reticulum].sort((a, b) => a.start - b.start);
}

interface RrcInlineOpts {
  /** Localized aria-label lookup (passed in; these are module functions, not hooks). */
  t: (key: string, opts?: Record<string, unknown>) => string;
  /** Non-http Reticulum address click; the component decides page vs DM vs prompt. */
  onAddressClick?: (link: ReticulumChatLink) => void;
  /** Whether DM targets are actionable at all (no handler wired ⇒ render as text). */
  canOpenDm: boolean;
}

function reticulumAddressLabelKey(link: ReticulumChatLink): string {
  if (link.kind === 'nomadPage') return 'rrc.openNomadPage';
  return link.ambiguous ? 'rrc.openReticulumAddress' : 'rrc.openDm';
}

/** Inline URL + plain text segments (no block wrappers — keeps IRC one-liners). */
function renderRrcInlineText(text: string, keyPrefix: string, opts: RrcInlineOpts): ReactNode[] {
  const { t, onAddressClick, canOpenDm } = opts;
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const segment of findRrcLinkSegments(text)) {
    if (segment.start > last) {
      nodes.push(
        <span key={`${keyPrefix}-t-${last}`} className="whitespace-pre-wrap">
          {text.slice(last, segment.start)}
        </span>,
      );
    }
    const key = `${keyPrefix}-u-${segment.start}`;
    if (segment.kind === 'http') {
      if (isSafeChatUrl(segment.url)) {
        nodes.push(
          <a
            key={key}
            href={segment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-cyan-400 underline hover:text-cyan-300"
          >
            {segment.url}
          </a>,
        );
      } else {
        nodes.push(
          <span key={key} className="whitespace-pre-wrap">
            {segment.url}
          </span>,
        );
      }
      if (segment.trailing) {
        nodes.push(
          <span key={`${keyPrefix}-p-${segment.start}`} className="whitespace-pre-wrap">
            {segment.trailing}
          </span>,
        );
      }
    } else if (onAddressClick && (segment.kind === 'nomadPage' || canOpenDm)) {
      const link = segment;
      nodes.push(
        <button
          key={key}
          type="button"
          className={RRC_LINK_CLASS}
          aria-label={t(reticulumAddressLabelKey(link), { address: link.url })}
          onClick={() => {
            onAddressClick(link);
          }}
        >
          {link.url}
        </button>,
      );
    } else {
      nodes.push(
        <span key={key} className="whitespace-pre-wrap">
          {segment.url}
        </span>,
      );
    }
    last = segment.end;
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
function highlightRrcSelfMentions(text: string, nickname: string, opts: RrcInlineOpts): ReactNode {
  const nick = nickname.trim();
  if (!nick || !bodyMentionsRrcNick(text, nick)) {
    return <>{renderRrcInlineText(text, 'b', opts)}</>;
  }
  const nodes: ReactNode[] = [];
  let last = 0;
  let cursor = 0;
  let match = findNextRrcNickMention(text, nick, cursor);
  while (match) {
    if (match.start > last) {
      nodes.push(...renderRrcInlineText(text.slice(last, match.start), `t${last}`, opts));
    }
    nodes.push(
      <span key={`m-${match.start}`} className="font-bold text-red-500">
        {text.slice(match.start, match.end)}
      </span>,
    );
    last = match.end;
    cursor = match.end;
    match = findNextRrcNickMention(text, nick, cursor);
  }
  if (last < text.length) {
    nodes.push(...renderRrcInlineText(text.slice(last), `t${last}`, opts));
  }
  return nodes.length > 0 ? <>{nodes}</> : null;
}

function NickSpan({ nick }: { nick: string }) {
  if (!nick) return null;
  return <span className={`font-semibold ${rrcNickColorClass(nick)}`}>{nick}</span>;
}

export interface RrcChatViewProps {
  connected: boolean;
  /** Focused hub hash — stream identity with activeRoom (hub switch must re-pin). */
  hubDestHash?: string | null;
  activeRoom: string | null;
  messages: RrcChatMessage[];
  showTimestamps: boolean;
  canSend: boolean;
  isMuted: boolean;
  /** Hub WELCOME max_msg_body_bytes (drives ChatComposer payloadLimit). */
  maxMsgBodyBytes?: number | null;
  /** Local session nick — used to highlight @mentions of self. */
  nickname?: string;
  /** Active room members for @ nick completion. */
  members?: readonly RrcRoomMember[];
  /** Keep the per-message copy control visible (same App Appearance setting as Chat). */
  alwaysShowMessageActions?: boolean;
  /** Composer placeholder override (e.g. whisper reply hint). */
  placeholder?: string;
  /** When false, skip follow-on-append and snapshot scroll for tab restore. */
  isActive?: boolean;
  /** Called when the user has scrolled to (or restored) the latest messages. */
  onCaughtUp?: () => void;
  /** Open a Chat DM for an LXMF destination hash posted in a message. */
  onOpenDm?: (destinationHash: string) => void;
  /** Plain chat / action chunk send (ChatComposer may call multiple times when splitting). */
  onSendChunk: (text: string) => Promise<void>;
  /**
   * When true, ChatComposer skips split/send (slash commands). Return false for plain chat.
   */
  onInterceptSend: (text: string) => Promise<boolean>;
  /** Seed composer from nicklist `/msg` clicks. */
  composeSeed?: { text: string; token: number } | null;
}

export function RrcChatView({
  connected,
  hubDestHash = null,
  activeRoom,
  messages,
  showTimestamps,
  canSend,
  isMuted,
  maxMsgBodyBytes = null,
  nickname = '',
  members = EMPTY_RRC_MEMBERS,
  alwaysShowMessageActions = false,
  placeholder,
  isActive = true,
  onCaughtUp,
  onOpenDm,
  onSendChunk,
  onInterceptSend,
  composeSeed = null,
}: RrcChatViewProps) {
  const { t } = useTranslation();
  const { inactive: appWindowInactive } = useAppWindowActivity();
  const use24HourTime = useTimeFormatStore((s) => s.use24HourTime);
  const composerPlaceholder = placeholder ?? t('rrc.messagePlaceholder');
  /** Bare hash awaiting a Nomad-page-vs-DM choice from the user. */
  const [pendingAddress, setPendingAddress] = useState<{
    url: string;
    destinationHash: string;
  } | null>(null);

  const handleAddressClick = useCallback(
    (link: ReticulumChatLink) => {
      if (link.kind === 'nomadPage') {
        openNomadPageFromLink(link.url);
        return;
      }
      if (link.ambiguous) {
        setPendingAddress({ url: link.url, destinationHash: link.destinationHash });
        return;
      }
      onOpenDm?.(link.destinationHash);
    },
    [onOpenDm],
  );

  const inlineOpts = useMemo<RrcInlineOpts>(
    () => ({ t, onAddressClick: handleAddressClick, canOpenDm: onOpenDm != null }),
    [t, handleAddressClick, onOpenDm],
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** Sticky intent: user is reading latest messages and wants auto-follow on new traffic. */
  const isPinnedToBottomRef = useRef(true);
  /** Hub/room stream switch — trust pin until the user scrolls (virtualizer can lag). */
  const streamPinRef = useRef(false);
  const unreadStartIndexRef = useRef(-1);
  const savedScrollTopRef = useRef<number | null>(null);
  const savedWasPinnedToBottomRef = useRef(false);
  const wasActiveRef = useRef(isActive);
  const prevStreamKeyRef = useRef<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const visibleMessages = useMemo(() => messages.filter(shouldDisplayRrcChatMessage), [messages]);

  const nickLabels = useMemo(() => rrcMemberNickLabels(members), [members]);

  const mentionAdapter = useMemo(
    () => ({
      findAtCaret: findRrcAtMentionAtCaret,
      buildCandidates: (query: string) =>
        listRrcNickCompleteCandidates(nickLabels, query).map((name, i) => ({
          nodeId: i,
          name,
        })),
      formatInsert: (name: string) => `@${name} `,
    }),
    [nickLabels],
  );

  const composerViewKey = useMemo(() => {
    const hub = (hubDestHash ?? 'none').toLowerCase();
    const room = activeRoom ?? '_none';
    return `rrc:${hub}:${room}`;
  }, [hubDestHash, activeRoom]);

  const payloadLimit = resolveRrcMsgBodyLimit(maxMsgBodyBytes);

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
    const el = scrollContainerRef.current;
    if (!el) return false;
    // When the stream actually overflows, trust DOM distance. Virtualizer isAtEnd can
    // lag estimate→measure on large rooms and falsely clear the pin while scrollTop is maxed.
    const hasOverflow = el.scrollHeight > el.clientHeight + 1;
    if (hasOverflow) {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      return dist <= CHAT_SCROLL_END_THRESHOLD;
    }
    return messageVirtualizerRef.current.isAtEnd(CHAT_SCROLL_END_THRESHOLD);
  }, []);

  const updateScrollButtonVisibility = useCallback(() => {
    if (streamPinRef.current) {
      isPinnedToBottomRef.current = true;
      setShowScrollButton(false);
      return getDistFromChatBottom(scrollContainerRef.current, messagesEndRef.current, null);
    }
    const atEnd = computeIsAtChatEnd();
    isPinnedToBottomRef.current = atEnd;
    setShowScrollButton(!atEnd);
    return getDistFromChatBottom(scrollContainerRef.current, messagesEndRef.current, null);
  }, [computeIsAtChatEnd]);

  const applyNearBottomCaughtUp = useCallback(
    (distFromBottom: number) => {
      if (!isActive || appWindowInactive || distFromBottom >= 50) return;
      onCaughtUp?.();
    },
    [appWindowInactive, isActive, onCaughtUp],
  );

  const handleStreamScroll = useCallback(() => {
    streamPinRef.current = false;
    const distFromBottom = updateScrollButtonVisibility();
    if (distFromBottom != null) applyNearBottomCaughtUp(distFromBottom);
  }, [applyNearBottomCaughtUp, updateScrollButtonVisibility]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      messageVirtualizerRef.current.scrollToEnd({ behavior });
      isPinnedToBottomRef.current = true;
      setShowScrollButton(false);
      requestAnimationFrame(() => {
        const dist = updateScrollButtonVisibility();
        if (dist != null) applyNearBottomCaughtUp(dist);
      });
    },
    [applyNearBottomCaughtUp, updateScrollButtonVisibility],
  );

  /** Last visible id — rooms at the 500-message cap grow without length change. */
  const latestVisibleMessageId =
    visibleMessages.length > 0 ? (visibleMessages[visibleMessages.length - 1]?.id ?? null) : null;

  // Follow new messages when pinned (Rooms/Chat contract).
  useEffect(() => {
    if (!isActive || appWindowInactive || !activeRoom) return;
    if (isPinnedToBottomRef.current) {
      messageVirtualizerRef.current.scrollToEnd();
    }
    requestAnimationFrame(() => {
      const dist = updateScrollButtonVisibility();
      if (dist != null) applyNearBottomCaughtUp(dist);
    });
  }, [
    visibleMessages.length,
    latestVisibleMessageId,
    isActive,
    activeRoom,
    appWindowInactive,
    updateScrollButtonVisibility,
    applyNearBottomCaughtUp,
  ]);

  // Hub and/or room switch while active → pin + scroll to end.
  // Same room name on another hub (e.g. general) must still re-pin; room-only key missed that.
  useLayoutEffect(() => {
    const streamKey =
      activeRoom && hubDestHash
        ? `${hubDestHash.toLowerCase()}::${activeRoom}`
        : activeRoom
          ? `::${activeRoom}`
          : null;
    const prevKey = prevStreamKeyRef.current;
    prevStreamKeyRef.current = streamKey;
    if (!isActive) return;
    if (!streamKey) return;
    if (prevKey === streamKey) return;
    streamPinRef.current = true;
    isPinnedToBottomRef.current = true;
    messageVirtualizerRef.current.scrollToEnd();
    setShowScrollButton(false);
  }, [activeRoom, hubDestHash, isActive]);

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
          requestAnimationFrame(() => {
            const dist = updateScrollButtonVisibility();
            if (dist != null) applyNearBottomCaughtUp(dist);
          });
        } else if (el) {
          el.scrollTop = savedScrollTopRef.current;
        }
        savedScrollTopRef.current = null;
        savedWasPinnedToBottomRef.current = false;
      }
    }
  }, [applyNearBottomCaughtUp, isActive, updateScrollButtonVisibility]);

  // Row estimates are px, calibrated to the current root scale. Cached measurements
  // for off-screen rows survive a scale change, so drop them and re-anchor.
  useEffect(
    () =>
      subscribeAppliedFontScale(() => {
        messageVirtualizerRef.current.measure();
        if (isPinnedToBottomRef.current) {
          messageVirtualizerRef.current.scrollToEnd();
        }
      }),
    [],
  );

  useEffect(() => {
    if (!isActive) return;
    const onFocus = () => {
      requestAnimationFrame(() => {
        const dist = updateScrollButtonVisibility();
        if (dist != null) applyNearBottomCaughtUp(dist);
      });
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [applyNearBottomCaughtUp, isActive, updateScrollButtonVisibility]);

  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      updateScrollButtonVisibility();
    });
  }, [updateScrollButtonVisibility]);

  if (!connected) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-gray-400">
        {t('rrc.selectHubPrompt')}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col font-mono text-[0.8125rem]">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollContainerRef}
          data-testid="rrc-message-stream"
          onScroll={handleStreamScroll}
          className="h-full min-h-0 overflow-y-auto overscroll-contain px-3 py-2 [overflow-anchor:none]"
        >
          {!activeRoom && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-gray-400">
              <p>{t('rrc.joinRoomPrompt')}</p>
              <p className="text-muted max-w-md text-xs">{t('rrc.joinRoomHelp')}</p>
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
                const whisperEcho = msg.kind === 'system' ? parseRrcWhisperEcho(msg.body) : null;
                // Inbound whispers are wire NOTICE; outbound are msg; legacy → system → self nick.
                const selfNick = nickname.trim();
                const lineNick = whisperEcho
                  ? selfNick || formatHash(msg.sender_hash ?? '') || 'me'
                  : nick;
                const whisperAsRoomMsg =
                  Boolean(whisperEcho) ||
                  (isRrcWhisperRoom(activeRoom) &&
                    (msg.kind === 'notice' || msg.kind === 'msg') &&
                    Boolean(nick));
                const lineClass = whisperAsRoomMsg
                  ? 'text-gray-100'
                  : msg.kind === 'notice' || msg.kind === 'system'
                    ? 'text-gray-400'
                    : msg.kind === 'action'
                      ? 'text-cyan-200/90 italic'
                      : msg.kind === 'error'
                        ? 'text-red-300'
                        : 'text-gray-100';
                const rawBody = whisperEcho ? whisperEcho.text : msg.body;
                const plainBody = highlightRrcSelfMentions(rawBody, nickname, inlineOpts);
                const body =
                  msg.kind === 'msg' || msg.kind === 'action' || whisperAsRoomMsg ? (
                    <RrcFormattedBody text={rawBody} fallback={plainBody} onOpenDm={onOpenDm} />
                  ) : (
                    plainBody
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
                        <span className="text-muted shrink-0 text-[0.625rem]">[{time}]</span>
                      )}
                      <div className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                        {msg.kind === 'action' ? (
                          <>
                            * <NickSpan nick={nick} /> {body}
                          </>
                        ) : whisperAsRoomMsg || msg.kind === 'msg' ? (
                          <>
                            <span className={`font-semibold ${rrcNickColorClass(lineNick)}`}>
                              &lt;{lineNick}&gt;
                            </span>{' '}
                            {body}
                          </>
                        ) : msg.kind === 'notice' ||
                          msg.kind === 'system' ||
                          msg.kind === 'error' ? (
                          <>
                            {msg.kind === 'notice' && nick ? (
                              <span className={rrcNickColorClass(nick)}>-{nick}- </span>
                            ) : (
                              <span className="text-gray-500">* </span>
                            )}
                            {body}
                          </>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className={`message-action shrink-0 rounded p-0.5 text-xs text-gray-600 ${
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
            className="bg-deep-black/95 absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-100 shadow-lg transition-all hover:bg-gray-800"
            aria-label={t('rrc.jumpToLatest')}
          >
            <ArrowDown aria-hidden className="h-3.5 w-3.5" size={14} />
            {t('rrc.jumpToLatest')}
          </button>
        )}
      </div>
      <div className="border-t border-gray-700 p-2 font-sans">
        <ChatComposer
          protocol="reticulum"
          viewKey={composerViewKey}
          isConnected={canSend}
          allowOutbox={false}
          disabled={isMuted || !activeRoom}
          placeholder={composerPlaceholder}
          sendButtonLabel={t('rrc.send')}
          payloadLimit={payloadLimit}
          useWireByteCount
          shouldSuppressLimits={rrcComposerBypassesSplit}
          onInterceptSend={onInterceptSend}
          onSendChunk={onSendChunk}
          mentionAdapter={mentionAdapter}
          composeSeed={composeSeed}
          className="w-full"
        />
      </div>
      {pendingAddress && (
        <ConfirmModal
          title={t('rrc.addressChoiceTitle')}
          message={t('rrc.addressChoiceMessage', { address: pendingAddress.url })}
          confirmLabel={t('rrc.addressChoiceNomad')}
          altActionLabel={t('rrc.addressChoiceDm')}
          onConfirm={() => {
            openNomadPageFromLink(pendingAddress.url);
            setPendingAddress(null);
          }}
          onAltAction={() => {
            onOpenDm?.(pendingAddress.destinationHash);
            setPendingAddress(null);
          }}
          onCancel={() => {
            setPendingAddress(null);
          }}
        />
      )}
    </div>
  );
}
