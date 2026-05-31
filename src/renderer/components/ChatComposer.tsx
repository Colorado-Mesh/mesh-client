/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs */
import 'emoji-picker-element';

import { type RefObject, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { nodeDisplayName } from '@/renderer/lib/nodeLongNameOrHex';
import type { ChatMessage, MeshNode, MeshProtocol } from '@/renderer/lib/types';
import type { OutboxEntry, OutboxEntryInput } from '@/shared/electron-api.types';

import {
  type ComposerWireContext,
  computeComposerLimitStatus,
  getComposerWireOverhead,
  MAX_CHUNKS,
  splitChatMessage,
} from '../lib/chatComposerLimits';
import { clearDraft, loadDraftsInitial, saveDraft } from '../lib/chatPanelProtocolStorage';
import { HelpTooltip } from './HelpTooltip';
import MentionAutocomplete, { buildMentionCandidates } from './MentionAutocomplete';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'emoji-picker': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export interface ChatComposerSendOpts {
  replyId?: number;
  chunkIndex?: number;
}

export interface ChatComposerProps {
  protocol: MeshProtocol;
  viewKey: string;
  isConnected: boolean;
  connectionType?: 'ble' | 'serial' | 'http' | null;
  isMqttOnly?: boolean;
  /** When false, disconnected sends fail instead of queueing (room posts). Default true. */
  allowOutbox?: boolean;
  placeholder?: string;
  disabled?: boolean;
  payloadLimit?: number;
  /** MeshCore wire context for payload limit (ignored for Meshtastic). Default channel. */
  composerContext?: ComposerWireContext;
  /** MeshCore channel: advert/display name for dynamic payload limit. */
  senderDisplayName?: string;
  /** Static send button label when not sending/chunking (e.g. "Post"). */
  sendButtonLabel?: string;
  /** Static sending label (e.g. "Posting…"). */
  sendingButtonLabel?: string;
  variant?: 'chat' | 'room';
  isDmMode?: boolean;
  replyTo?: ChatMessage | null;
  onReplyClear?: () => void;
  mentionNodes?: Map<number, MeshNode>;
  /** Outbox routing when allowOutbox is true. */
  outboxChannel?: number;
  outboxDestination?: number;
  /** When provided, used instead of an internal outbox hook (ChatPanel shares one instance for message list). */
  queueOutbox?: (entry: OutboxEntryInput) => Promise<OutboxEntry>;
  onSendChunk: (text: string, opts?: ChatComposerSendOpts) => Promise<void>;
  /** Called after a successful send (e.g. clear unread divider). */
  onSendSuccess?: () => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  className?: string;
}

export function ChatComposer({
  protocol,
  viewKey,
  isConnected,
  isMqttOnly = false,
  allowOutbox = true,
  placeholder,
  disabled = false,
  payloadLimit,
  composerContext = 'channel',
  senderDisplayName,
  sendButtonLabel,
  sendingButtonLabel,
  variant = 'chat',
  isDmMode = false,
  replyTo,
  onReplyClear,
  mentionNodes,
  outboxChannel = 0,
  outboxDestination,
  queueOutbox: queueOutboxProp,
  onSendChunk,
  onSendSuccess,
  textareaRef,
  className,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const isLinux = useMemo(() => window.electronAPI.getPlatform() === 'linux', []);
  const limitHintId = useId();
  const counterLiveId = useId();

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatActionError, setChatActionError] = useState<{
    message: string;
    viewKey: string;
  } | null>(null);
  const [showComposePicker, setShowComposePicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionTriggerPos, setMentionTriggerPos] = useState(0);
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerRef = useRef<HTMLElement | null>(null);
  const inputValueRef = useRef(input);
  inputValueRef.current = input;
  const prevViewKeyRef = useRef<string | null>(null);

  const replyToSenderName = replyTo?.sender_name;

  const limitStatus = useMemo(
    () =>
      computeComposerLimitStatus(input, protocol, {
        payloadLimitOverride: payloadLimit,
        composerContext,
        senderDisplayName,
        replyToSenderName,
      }),
    [input, protocol, payloadLimit, composerContext, senderDisplayName, replyToSenderName],
  );

  const wireOverheadFirstChunk = useMemo(
    () =>
      getComposerWireOverhead({
        protocol,
        replyToSenderName,
      }),
    [protocol, replyToSenderName],
  );

  const maxInputLength = limitStatus.totalMaxChars;

  const inputChunks = useMemo(
    () =>
      splitChatMessage(
        input.trim(),
        protocol,
        limitStatus.singleMessageLimit,
        wireOverheadFirstChunk,
      ),
    [input, protocol, limitStatus.singleMessageLimit, wireOverheadFirstChunk],
  );

  const emptyMentionNodes = useMemo(() => new Map<number, MeshNode>(), []);
  const nodes = mentionNodes ?? emptyMentionNodes;

  const noopQueue = useCallback((entry: OutboxEntryInput): Promise<OutboxEntry> => {
    void entry;
    return Promise.reject(new Error('Outbox queue unavailable'));
  }, []);

  const queueOutbox = queueOutboxProp ?? noopQueue;

  // Draft persistence: save/restore unsent input when viewKey changes
  useEffect(() => {
    const prevKey = prevViewKeyRef.current;
    if (prevKey !== null && prevKey !== viewKey) {
      const currentInput = inputValueRef.current;
      if (currentInput.trim()) {
        saveDraft(protocol, prevKey, currentInput);
      } else {
        clearDraft(protocol, prevKey);
      }
    }
    prevViewKeyRef.current = viewKey;
    const drafts = loadDraftsInitial(protocol);
    setInput(drafts[viewKey] ?? '');
    setMentionQuery(null);
    setChatActionError(null);
  }, [viewKey, protocol]);

  const mentionCandidates = useMemo(
    () => (mentionQuery != null ? buildMentionCandidates(nodes, protocol, mentionQuery) : []),
    [mentionQuery, nodes, protocol],
  );

  const insertMention = useCallback(
    (name: string) => {
      const textarea = inputRef.current;
      const currentInput = inputValueRef.current;
      const insert = `@[${name}] `;
      const before = currentInput.slice(0, mentionTriggerPos);
      const after = currentInput.slice(mentionTriggerPos + (mentionQuery?.length ?? 0) + 1);
      const newVal = before + insert + after;
      if (newVal.length > maxInputLength) return;
      setInput(newVal);
      setMentionQuery(null);
      requestAnimationFrame(() => {
        const newCursor = mentionTriggerPos + insert.length;
        textarea?.focus();
        textarea?.setSelectionRange(newCursor, newCursor);
      });
    },
    [maxInputLength, mentionTriggerPos, mentionQuery],
  );

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending || disabled) return;
    const chunks = splitChatMessage(
      input.trim(),
      protocol,
      limitStatus.singleMessageLimit,
      wireOverheadFirstChunk,
    );
    if (chunks === null) return;

    const replyKey =
      replyTo == null
        ? undefined
        : protocol === 'meshtastic'
          ? replyTo.packetId
          : (replyTo.packetId ?? replyTo.timestamp);
    const textsToSend = chunks.length === 0 ? [input.trim()] : chunks;

    if (replyTo && protocol === 'meshtastic' && (replyKey == null || replyKey === 0)) {
      setChatActionError({
        message: t('chatPanel.replyRequiresPacketId'),
        viewKey,
      });
      return;
    }

    const shouldQueue = allowOutbox && (!isConnected || (isMqttOnly && protocol === 'meshcore'));

    if (shouldQueue) {
      if (!queueOutboxProp) return;
      const groupId = textsToSend.length > 1 ? crypto.randomUUID() : null;
      for (let i = 0; i < textsToSend.length; i++) {
        await queueOutbox({
          protocol,
          viewKey,
          channel: outboxChannel,
          toNode: outboxDestination ?? null,
          payload: textsToSend[i],
          replyId: i === 0 ? (replyKey ?? null) : null,
          status: 'queued',
          error: null,
          nextRetryAt: null,
          groupId,
          groupIndex: groupId ? i : null,
          groupTotal: groupId ? textsToSend.length : null,
        });
      }
      setInput('');
      clearDraft(protocol, viewKey);
      setMentionQuery(null);
      onReplyClear?.();
      onSendSuccess?.();
      return;
    }

    if (!isConnected) {
      setChatActionError({
        message: t('chatPanel.composePlaceholderConnectFirst'),
        viewKey,
      });
      return;
    }

    setSending(true);
    setChatActionError(null);
    try {
      for (let i = 0; i < textsToSend.length; i++) {
        await onSendChunk(textsToSend[i], {
          replyId: i === 0 ? replyKey : undefined,
          chunkIndex: i,
        });
      }
      setInput('');
      clearDraft(protocol, viewKey);
      setMentionQuery(null);
      onReplyClear?.();
      onSendSuccess?.();
    } catch (err) {
      console.error('[ChatComposer] Send failed: ' + errLikeToLogString(err));
      setChatActionError({
        message: err instanceof Error ? err.message : 'Send failed',
        viewKey,
      });
    } finally {
      setSending(false);
    }
  }, [
    allowOutbox,
    disabled,
    input,
    isConnected,
    isMqttOnly,
    limitStatus.singleMessageLimit,
    onReplyClear,
    onSendChunk,
    onSendSuccess,
    outboxChannel,
    outboxDestination,
    protocol,
    queueOutboxProp,
    queueOutbox,
    replyTo,
    sending,
    t,
    viewKey,
    wireOverheadFirstChunk,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mentionQuery != null && mentionCandidates.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionSelectedIdx((i) => Math.min(i + 1, mentionCandidates.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionSelectedIdx((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          const candidate = mentionCandidates[mentionSelectedIdx];
          if (candidate) insertMention(candidate.name);
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend, insertMention, mentionCandidates, mentionQuery, mentionSelectedIdx],
  );

  useEffect(() => {
    const el = emojiPickerRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const unicode: string = (e as CustomEvent).detail.emoji.unicode;
      const textarea = inputRef.current;
      const currentValue = textarea?.value ?? '';
      const start = textarea?.selectionStart ?? currentValue.length;
      const end = textarea?.selectionEnd ?? currentValue.length;
      const newVal = currentValue.slice(0, start) + unicode + currentValue.slice(end);
      if (newVal.length > maxInputLength) return;
      setInput(newVal);
      setShowComposePicker(false);
      requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(start + unicode.length, start + unicode.length);
      });
    };
    el.addEventListener('emoji-click', handler);
    return () => {
      el.removeEventListener('emoji-click', handler);
    };
  }, [maxInputLength, showComposePicker]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showComposePicker) {
        setShowComposePicker(false);
      } else if (mentionQuery != null) {
        setMentionQuery(null);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [mentionQuery, showComposePicker]);

  const composePlaceholder =
    placeholder ??
    (isDmMode
      ? t('chatPanel.composePlaceholderDefault')
      : !isConnected
        ? t('chatPanel.composePlaceholderConnectFirst')
        : isMqttOnly
          ? t('chatPanel.composePlaceholderMqttOnly')
          : t('chatPanel.composePlaceholderDefault'));

  const limitHintText = t('chatPanel.composeLimit.limitHint', {
    limit: limitStatus.singleMessageLimit,
  });

  const showQueueButton = allowOutbox && (!isConnected || (isMqttOnly && protocol === 'meshcore'));

  const sendLabel = (() => {
    if (sending) {
      return sendingButtonLabel ?? t('chatPanel.sendButtonSending');
    }
    if (showQueueButton) return t('chatPanel.queueButton');
    if (inputChunks !== null && inputChunks.length > 0) {
      return t('chatPanel.composeLimit.sendParts', { count: inputChunks.length });
    }
    if (sendButtonLabel) return sendButtonLabel;
    return isDmMode ? t('chatPanel.sendButtonDm') : t('chatPanel.sendButton');
  })();

  const showCounter = limitStatus.phase !== 'ok';
  const counterAtLimit =
    limitStatus.phase === 'warn' &&
    limitStatus.charCount >= limitStatus.singleMessageLimit - wireOverheadFirstChunk;

  const counterMainText = (() => {
    if (limitStatus.phase === 'overMax') {
      return t('chatPanel.composeLimit.overMax', {
        totalMax: limitStatus.totalMaxChars,
        maxParts: MAX_CHUNKS,
      });
    }
    if (limitStatus.phase === 'split') {
      return t('chatPanel.composeLimit.split', {
        count: limitStatus.charCount,
        parts: limitStatus.chunkCount,
      });
    }
    return t('chatPanel.composeLimit.approaching', {
      count: limitStatus.charCount,
      limit: limitStatus.singleMessageLimit,
    });
  })();

  const counterLiveText =
    limitStatus.phase === 'split' || limitStatus.phase === 'overMax' ? counterMainText : undefined;

  const textareaClass =
    variant === 'room'
      ? 'max-h-32 min-h-[42px] w-full resize-none overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-200 transition-colors focus:outline-none focus:border-brand-green/50 focus:ring-1 focus:ring-brand-green/30'
      : `max-h-32 min-h-[42px] w-full resize-none overflow-y-auto rounded-xl border px-4 py-2.5 text-gray-200 transition-colors focus:outline-none ${
          isDmMode
            ? 'border-purple-600/50 bg-purple-900/20 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30'
            : 'bg-secondary-dark/80 focus:border-brand-green/50 focus:ring-brand-green/30 border-gray-600/50 focus:ring-1'
        }`;

  const sendButtonClass =
    variant === 'room'
      ? 'bg-brand-green/20 text-brand-green border-brand-green/40 hover:bg-brand-green/30 rounded border px-4 py-2 text-sm font-medium disabled:opacity-40'
      : `rounded-xl px-5 py-2.5 font-medium transition-colors ${
          showQueueButton
            ? 'disabled:text-muted bg-slate-600 text-white hover:bg-slate-500 disabled:bg-gray-600'
            : isDmMode
              ? 'disabled:text-muted bg-purple-600 text-white hover:bg-purple-500 disabled:bg-gray-600'
              : 'disabled:text-muted bg-green-500 text-white hover:bg-green-400 disabled:bg-gray-600'
        }`;

  const emojiButtonClass =
    variant === 'room'
      ? `rounded-lg px-2.5 py-2 transition-colors disabled:opacity-50 ${
          showComposePicker
            ? 'bg-brand-green/20 text-brand-green'
            : 'border border-gray-600 bg-gray-800 text-gray-400 hover:text-gray-200'
        }`
      : `rounded-xl px-2.5 py-2.5 transition-colors disabled:opacity-50 ${
          showComposePicker
            ? 'bg-brand-green/20 text-bright-green'
            : 'bg-secondary-dark/80 text-muted border border-gray-600/50 hover:text-gray-300'
        }`;

  return (
    <div className={className}>
      {isLinux && showComposePicker && (
        <emoji-picker
          ref={emojiPickerRef}
          style={{ width: '100%', maxWidth: '350px', alignSelf: 'flex-start' }}
        />
      )}

      {replyTo && onReplyClear && (
        <div className="bg-secondary-dark/80 mb-1 flex items-center gap-2 rounded-xl border border-gray-600/50 px-3 py-1.5 text-xs">
          <svg
            className="h-3 w-3 shrink-0 text-blue-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
            />
          </svg>
          <span className="text-gray-400">
            {t('chatPanel.replyingTo')}{' '}
            <span className="font-medium text-gray-200">
              {nodeDisplayName(nodes.get(replyTo.sender_id), protocol) || replyTo.sender_name}
            </span>
            :
          </span>
          <span className="flex-1 truncate text-gray-500">
            {replyTo.payload.length > 60 ? replyTo.payload.slice(0, 60) + '…' : replyTo.payload}
          </span>
          <button
            type="button"
            onClick={onReplyClear}
            className="text-muted ml-1 leading-none hover:text-gray-200"
            title={t('chatPanel.cancelReply')}
            aria-label={t('chatPanel.cancelReply')}
          >
            ×
          </button>
        </div>
      )}

      {chatActionError?.viewKey === viewKey && (
        <div role="alert" className="mb-2 px-1 text-sm text-red-400">
          {chatActionError.message}
        </div>
      )}

      <span id={limitHintId} className="sr-only">
        {limitHintText}
      </span>
      {counterLiveText != null && (
        <span id={counterLiveId} className="sr-only" aria-live="polite" aria-atomic="true">
          {counterLiveText}
        </span>
      )}

      <div className="flex min-w-0 gap-2">
        <div className="relative min-w-0 flex-1">
          {mentionQuery != null && mentionCandidates.length > 0 && (
            <MentionAutocomplete
              candidates={mentionCandidates}
              selectedIdx={mentionSelectedIdx}
              onSelect={insertMention}
              onSetSelectedIdx={setMentionSelectedIdx}
            />
          )}
          <textarea
            ref={(el) => {
              inputRef.current = el;
              if (textareaRef) {
                textareaRef.current = el;
              }
            }}
            rows={1}
            value={input}
            onChange={(e) => {
              const val = e.target.value;
              setInput(val);
              setChatActionError(null);
              const match = /@(\w*)$/.exec(val);
              if (match) {
                setMentionQuery(match[1]);
                setMentionTriggerPos(val.length - match[0].length);
                setMentionSelectedIdx(0);
              } else {
                setMentionQuery(null);
              }
            }}
            onKeyDown={handleKeyDown}
            spellCheck
            lang={
              typeof navigator !== 'undefined' && navigator.language
                ? navigator.language
                : undefined
            }
            enterKeyHint="send"
            placeholder={composePlaceholder}
            aria-label={composePlaceholder}
            aria-describedby={limitHintId}
            disabled={disabled || sending || (!isConnected && !allowOutbox)}
            className={`${textareaClass} ${!isConnected || sending ? 'opacity-60' : ''} ${disabled ? 'opacity-40' : ''}`}
            maxLength={maxInputLength}
          />
        </div>
        <HelpTooltip text={t('chatPanel.insertEmoji')}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              if (!isLinux) inputRef.current?.focus();
            }}
            onClick={() => {
              if (isLinux) {
                setShowComposePicker((prev) => !prev);
              } else {
                void window.electronAPI.showEmojiPanel();
              }
            }}
            disabled={disabled || !isConnected || sending}
            aria-label={t('chatPanel.emojiButton')}
            className={emojiButtonClass}
          >
            😊
          </button>
        </HelpTooltip>
        <button
          type="button"
          onClick={() => {
            void handleSend();
          }}
          disabled={!input.trim() || sending || inputChunks === null || disabled}
          aria-label={sendLabel}
          className={sendButtonClass}
        >
          {sendLabel}
        </button>
      </div>

      {showCounter && (
        <div className="mt-1 flex items-center justify-end gap-1 text-right text-xs">
          <span
            className={
              limitStatus.phase === 'overMax'
                ? 'text-red-400'
                : limitStatus.phase === 'split' || counterAtLimit
                  ? 'text-amber-400'
                  : 'text-muted'
            }
          >
            {counterMainText}
          </span>
          {limitStatus.phase === 'split' && (
            <HelpTooltip text={t('chatPanel.composeLimit.splitHint')}>
              <span
                className="text-muted cursor-help select-none"
                aria-label={t('chatPanel.composeLimit.splitHint')}
              >
                ⓘ
              </span>
            </HelpTooltip>
          )}
        </div>
      )}
    </div>
  );
}
