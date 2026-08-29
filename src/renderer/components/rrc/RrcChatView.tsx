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

import { ConfirmModal } from '@/renderer/components/ConfirmModal';
import MentionAutocomplete from '@/renderer/components/MentionAutocomplete';
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
import {
  bodyMentionsRrcNick,
  findNextRrcNickMention,
  isRrcWhisperRoom,
} from '@/renderer/lib/rrcMention';
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
const RRC_MENTION_LISTBOX_ID = 'rrc-mention-listbox';

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
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: (text: string) => void;
  canSend: boolean;
  isMuted: boolean;
  /** Local session nick — used to highlight @mentions of self. */
  nickname?: string;
  /** Active room members for @ / Tab nick completion. */
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
}

export function RrcChatView({
  connected,
  hubDestHash = null,
  activeRoom,
  messages,
  showTimestamps,
  draft,
  onDraftChange,
  onSend,
  canSend,
  isMuted,
  nickname = '',
  members = EMPTY_RRC_MEMBERS,
  alwaysShowMessageActions = false,
  placeholder,
  isActive = true,
  onCaughtUp,
  onOpenDm,
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Skip one caret sync after programmatic Tab/insert selection updates. */
  const skipMentionSyncRef = useRef(false);
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

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionTriggerPos, setMentionTriggerPos] = useState(0);
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);
  const [tabCycleIndex, setTabCycleIndex] = useState(-1);
  /** Original `@` prefix while Tab-cycling so candidates do not narrow to the inserted nick. */
  const [mentionCyclePrefix, setMentionCyclePrefix] = useState<string | null>(null);
  /** Length of the nick currently inserted during an active Tab cycle. */
  const [mentionInsertedNickLen, setMentionInsertedNickLen] = useState(0);

  const visibleMessages = useMemo(() => messages.filter(shouldDisplayRrcChatMessage), [messages]);

  const nickLabels = useMemo(() => rrcMemberNickLabels(members), [members]);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery == null) return [];
    const filterQuery = mentionCyclePrefix ?? mentionQuery;
    return listRrcNickCompleteCandidates(nickLabels, filterQuery).map((name, i) => ({
      nodeId: i,
      name,
    }));
  }, [mentionQuery, mentionCyclePrefix, nickLabels]);

  const clearMentionCycle = useCallback(() => {
    setMentionCyclePrefix(null);
    setMentionInsertedNickLen(0);
    setTabCycleIndex(-1);
  }, []);

  const syncMentionFromCaret = useCallback(
    (value: string, caret: number) => {
      const at = findRrcAtMentionAtCaret(value, caret);
      if (!at) {
        setMentionQuery(null);
        clearMentionCycle();
        return;
      }
      setMentionTriggerPos(at.start);
      setMentionQuery(at.query);
      setMentionSelectedIdx(0);
      clearMentionCycle();
    },
    [clearMentionCycle],
  );

  const insertMention = useCallback(
    (name: string) => {
      const queryLen =
        mentionCyclePrefix != null ? mentionInsertedNickLen : (mentionQuery?.length ?? 0);
      const { text, caret } = insertRrcNickMention(draft, mentionTriggerPos, queryLen, name);
      onDraftChange(text);
      setMentionQuery(null);
      clearMentionCycle();
      skipMentionSyncRef.current = true;
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(caret, caret);
      });
    },
    [
      clearMentionCycle,
      draft,
      mentionCyclePrefix,
      mentionInsertedNickLen,
      mentionQuery,
      mentionTriggerPos,
      onDraftChange,
    ],
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
        clearMentionCycle();
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
        const cycling = mentionCyclePrefix != null;
        const prefix = cycling ? mentionCyclePrefix : mentionQuery;
        const names = listRrcNickCompleteCandidates(nickLabels, prefix);
        const nextIdx = nextRrcNickCompleteIndex(names, tabCycleIndex, e.shiftKey);
        if (nextIdx < 0) return;
        const nick = names[nextIdx];
        if (!nick) return;
        const replaceLen = cycling ? mentionInsertedNickLen : mentionQuery.length;
        if (!cycling) setMentionCyclePrefix(mentionQuery);
        setMentionInsertedNickLen(nick.length);
        setTabCycleIndex(nextIdx);
        setMentionSelectedIdx(nextIdx);
        const { text, caret } = insertRrcNickMention(draft, mentionTriggerPos, replaceLen, nick);
        onDraftChange(text);
        // Keep dropdown open for further Tab cycles (query = completed nick).
        setMentionQuery(nick);
        skipMentionSyncRef.current = true;
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
        setMentionCyclePrefix(at.query);
        setMentionInsertedNickLen(nick.length);
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
        skipMentionSyncRef.current = true;
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(newCaret, newCaret);
        });
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      setMentionQuery(null);
      clearMentionCycle();
      onSend(draft);
    }
  };

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
                const body = highlightRrcSelfMentions(
                  whisperEcho ? whisperEcho.text : msg.body,
                  nickname,
                  inlineOpts,
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
      <div className="relative flex gap-2 border-t border-gray-700 p-2">
        {mentionQuery != null && mentionCandidates.length > 0 && (
          <MentionAutocomplete
            listboxId={RRC_MENTION_LISTBOX_ID}
            candidates={mentionCandidates}
            selectedIdx={mentionSelectedIdx}
            onSelect={insertMention}
            onSetSelectedIdx={setMentionSelectedIdx}
          />
        )}
        <div
          role="combobox"
          tabIndex={-1}
          aria-label={composerPlaceholder}
          aria-haspopup="listbox"
          aria-expanded={mentionQuery != null && mentionCandidates.length > 0}
          aria-controls={RRC_MENTION_LISTBOX_ID}
          aria-activedescendant={
            mentionQuery != null && mentionCandidates.length > 0
              ? `${RRC_MENTION_LISTBOX_ID}-option-${mentionSelectedIdx}`
              : undefined
          }
          className="min-w-0 flex-1"
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              const value = e.target.value;
              onDraftChange(value);
              syncMentionFromCaret(value, e.target.selectionStart ?? value.length);
            }}
            onSelect={(e) => {
              if (skipMentionSyncRef.current) {
                skipMentionSyncRef.current = false;
                return;
              }
              const el = e.currentTarget;
              syncMentionFromCaret(el.value, el.selectionStart ?? el.value.length);
            }}
            onKeyDown={handleComposerKeyDown}
            disabled={!canSend || isMuted}
            placeholder={composerPlaceholder}
            aria-label={composerPlaceholder}
            aria-autocomplete="list"
            rows={2}
            className="bg-deep-black w-full resize-none rounded border border-gray-600 px-2 py-1.5 font-sans text-sm text-gray-100 disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          className="bg-readable-green self-end rounded px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          aria-label={t('rrc.send')}
          disabled={!canSend || isMuted || !draft.trim()}
          onClick={() => {
            onSend(draft);
          }}
        >
          {t('rrc.send')}
        </button>
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
