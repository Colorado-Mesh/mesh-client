/* eslint-disable react-hooks/refs */
import 'emoji-picker-element';

import { CornerUpLeft } from 'lucide-react-motion';
import { type RefObject, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { nodeDisplayName } from '@/renderer/lib/nodeLongNameOrHex';
import type { ChatMessage, MeshNode, MeshProtocol } from '@/renderer/lib/types';
import type { OutboxEntry, OutboxEntryInput } from '@/shared/electron-api.types';

import { isMeshcoreOpenWireCompatEnabled } from '../lib/appSettingsStorage';
import {
  type ComposerWireContext,
  computeComposerLimitStatus,
  getComposerWireOverhead,
  MAX_CHUNKS,
  splitChatMessage,
} from '../lib/chatComposerLimits';
import { clearDraft, loadDraftsInitial, saveDraft } from '../lib/chatPanelProtocolStorage';
import {
  formatMeshcoreGifWire,
  meshcoreGiphyMediaUrl,
  normalizeMeshcoreGifOutboundWire,
  parseMeshcoreGifId,
} from '../lib/meshcoreGifWire';
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
  /** Reticulum ratspeak.chat.v2 reply target (LXMF message hash). */
  replyHash?: string;
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
  /** Reticulum LXMF file/image attachment send (requires DM destination). */
  onSendAttachment?: (file: File, destination: number) => Promise<void>;
  /** Called after a successful send (e.g. clear unread divider). */
  onSendSuccess?: () => void;
  /** Use LXMF message hash for reply threading (Reticulum). */
  lxmfReplyHashReplies?: boolean;
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
  onSendAttachment,
  onSendSuccess,
  lxmfReplyHashReplies = false,
  textareaRef,
  className,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const iconTrigger = useIconTrigger();
  const isLinux = useMemo(() => window.electronAPI.getPlatform() === 'linux', []);
  const limitHintId = useId();
  const counterLiveId = useId();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatActionError, setChatActionError] = useState<{
    message: string;
    viewKey: string;
  } | null>(null);
  const [showComposePicker, setShowComposePicker] = useState(false);
  const [showGifModal, setShowGifModal] = useState(false);
  const [gifInput, setGifInput] = useState('');
  const [gifPreviewFailed, setGifPreviewFailed] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionTriggerPos, setMentionTriggerPos] = useState(0);
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerRef = useRef<HTMLElement | null>(null);
  const inputValueRef = useRef(input);
  inputValueRef.current = input;
  const prevViewKeyRef = useRef<string | null>(null);

  const replyToSenderName = replyTo?.sender_name;
  const meshcoreOpenWireCompat =
    protocol === 'meshcore' ? isMeshcoreOpenWireCompatEnabled() : false;
  const replyKey =
    replyTo == null
      ? undefined
      : protocol === 'meshtastic'
        ? replyTo.packetId
        : lxmfReplyHashReplies
          ? undefined
          : (replyTo.packetId ?? replyTo.timestamp);
  const reticulumReplyHash =
    lxmfReplyHashReplies && replyTo?.reticulum_message_hash
      ? replyTo.reticulum_message_hash
      : undefined;

  const limitStatus = useMemo(
    () =>
      computeComposerLimitStatus(input, protocol, {
        payloadLimitOverride: payloadLimit,
        composerContext,
        senderDisplayName,
        replyToSenderName,
        replyKey,
        useKeyedReplies: meshcoreOpenWireCompat,
      }),
    [
      input,
      protocol,
      payloadLimit,
      composerContext,
      senderDisplayName,
      replyToSenderName,
      replyKey,
      meshcoreOpenWireCompat,
    ],
  );

  const wireOverheadFirstChunk = useMemo(
    () =>
      getComposerWireOverhead({
        protocol,
        replyToSenderName,
        replyKey,
        useKeyedReplies: meshcoreOpenWireCompat,
      }),
    [protocol, replyToSenderName, replyKey, meshcoreOpenWireCompat],
  );

  const gifPreviewId = useMemo(() => parseMeshcoreGifId(gifInput), [gifInput]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore per-view draft from localStorage on tab switch
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

  const clearSentDraft = useCallback(
    (draftSnapshot: string) => {
      setInput((prev) => {
        if (prev === draftSnapshot) {
          clearDraft(protocol, viewKey);
          return '';
        }
        return prev;
      });
    },
    [protocol, viewKey],
  );

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending || disabled) return;
    const draftSnapshot = input;
    let trimmedSend = input.trim();
    if (meshcoreOpenWireCompat) {
      const gifWire = normalizeMeshcoreGifOutboundWire(trimmedSend);
      if (gifWire != null) trimmedSend = gifWire;
    }
    const chunks = splitChatMessage(
      trimmedSend,
      protocol,
      limitStatus.singleMessageLimit,
      wireOverheadFirstChunk,
    );
    if (chunks === null) return;

    const textsToSend = chunks.length === 0 ? [trimmedSend] : chunks;

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
          replyId: i === 0 && typeof replyKey === 'number' ? replyKey : null,
          status: 'queued',
          error: null,
          nextRetryAt: null,
          groupId,
          groupIndex: groupId ? i : null,
          groupTotal: groupId ? textsToSend.length : null,
        });
      }
      clearSentDraft(draftSnapshot);
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
          replyId: i === 0 && typeof replyKey === 'number' ? replyKey : undefined,
          replyHash: i === 0 ? reticulumReplyHash : undefined,
          chunkIndex: i,
        });
      }
      clearSentDraft(draftSnapshot);
      setMentionQuery(null);
      onReplyClear?.();
      onSendSuccess?.();
    } catch (err) {
      console.error('[ChatComposer] Send failed: ' + errLikeToLogString(err));
      const fallback = variant === 'room' ? t('roomsPanel.postFailed') : t('chatPanel.sendFailed');
      setChatActionError({
        message: err instanceof Error ? err.message : fallback,
        viewKey,
      });
    } finally {
      setSending(false);
    }
  }, [
    allowOutbox,
    clearSentDraft,
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
    replyKey,
    reticulumReplyHash,
    sending,
    t,
    variant,
    viewKey,
    wireOverheadFirstChunk,
    meshcoreOpenWireCompat,
  ]);

  const sendGifWire = useCallback(
    async (wireText: string) => {
      if (sending || disabled) return;
      if (!isConnected && !allowOutbox) {
        setChatActionError({
          message: t('chatPanel.composePlaceholderConnectFirst'),
          viewKey,
        });
        return;
      }
      setSending(true);
      setChatActionError(null);
      try {
        await onSendChunk(wireText);
        setShowGifModal(false);
        setGifInput('');
        onSendSuccess?.();
      } catch (err) {
        console.error('[ChatComposer] GIF send failed: ' + errLikeToLogString(err));
        setChatActionError({
          message: err instanceof Error ? err.message : t('chatPanel.sendFailed'),
          viewKey,
        });
      } finally {
        setSending(false);
      }
    },
    [allowOutbox, disabled, isConnected, onSendChunk, onSendSuccess, sending, t, viewKey],
  );

  const handleGifConfirm = useCallback(() => {
    const gifId = parseMeshcoreGifId(gifInput);
    if (gifId == null) {
      setChatActionError({
        message: t('chatPanel.meshcoreGifInvalid'),
        viewKey,
      });
      return;
    }
    void sendGifWire(formatMeshcoreGifWire(gifId));
  }, [gifInput, sendGifWire, t, viewKey]);

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

  const showMeshcoreGifButton =
    protocol === 'meshcore' && meshcoreOpenWireCompat && variant === 'chat';

  return (
    <div className={className}>
      {showGifModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <button
            type="button"
            aria-label={t('common.cancel')}
            className="absolute inset-0 cursor-pointer border-0 bg-black/60 p-0 backdrop-blur-sm"
            onClick={() => {
              setShowGifModal(false);
              setGifInput('');
              setGifPreviewFailed(false);
            }}
          />
          <div className="bg-deep-black relative mx-4 w-full max-w-md space-y-4 rounded-xl border border-gray-600 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-200">
              {t('chatPanel.meshcoreGifTitle')}
            </h3>
            <p className="text-muted text-sm leading-relaxed">{t('chatPanel.meshcoreGifHint')}</p>
            <input
              type="text"
              value={gifInput}
              onChange={(e) => {
                setGifInput(e.target.value);
                setGifPreviewFailed(false);
                setChatActionError(null);
              }}
              placeholder={t('chatPanel.meshcoreGifPlaceholder')}
              aria-label={t('chatPanel.meshcoreGifPlaceholder')}
              className="bg-secondary-dark focus:border-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none"
            />
            {gifPreviewId != null && !gifPreviewFailed && (
              <img
                src={meshcoreGiphyMediaUrl(gifPreviewId)}
                alt={t('chatPayload.meshcoreGif')}
                className="max-h-48 max-w-full rounded-md border border-cyan-500/20 object-contain"
                onError={() => {
                  setGifPreviewFailed(true);
                }}
              />
            )}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowGifModal(false);
                  setGifInput('');
                  setGifPreviewFailed(false);
                }}
                aria-label={t('common.cancel')}
                className="bg-secondary-dark flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleGifConfirm();
                }}
                disabled={gifPreviewId == null || sending}
                aria-label={t('chatPanel.meshcoreGifSend')}
                className="flex-1 rounded-lg bg-yellow-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-yellow-500 disabled:opacity-40"
              >
                {t('chatPanel.meshcoreGifSend')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLinux && showComposePicker && (
        <emoji-picker
          ref={emojiPickerRef}
          style={{ width: '100%', maxWidth: '350px', alignSelf: 'flex-start' }}
        />
      )}

      {replyTo && onReplyClear && (
        <div className="bg-secondary-dark/80 mb-1 flex items-center gap-2 rounded-xl border border-gray-600/50 px-3 py-1.5 text-xs">
          <CornerUpLeft
            aria-hidden
            className="h-3 w-3 shrink-0 text-blue-400"
            trigger={iconTrigger}
            size={12}
          />
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
            aria-busy={sending}
            disabled={disabled || (!isConnected && !allowOutbox)}
            className={`${textareaClass} ${!isConnected ? 'opacity-60' : ''} ${disabled ? 'opacity-40' : ''}`}
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
            disabled={disabled || !isConnected}
            aria-label={t('chatPanel.emojiButton')}
            className={emojiButtonClass}
          >
            😊
          </button>
        </HelpTooltip>
        {onSendAttachment ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file || disabled || !isConnected) return;
                if (outboxDestination == null) {
                  setChatActionError({
                    message: t('chatPanel.attachDmOnly'),
                    viewKey,
                  });
                  return;
                }
                void (async () => {
                  setSending(true);
                  try {
                    await onSendAttachment(file, outboxDestination);
                    onSendSuccess?.();
                  } catch (err) {
                    // catch-no-log-ok: attachment failure shown inline in composer
                    setChatActionError({
                      message: errLikeToLogString(err),
                      viewKey,
                    });
                  } finally {
                    setSending(false);
                  }
                })();
              }}
            />
            <HelpTooltip text={t('chatPanel.attachFileHint')}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || !isConnected || sending}
                aria-label={t('chatPanel.attachFile')}
                className={emojiButtonClass}
              >
                📎
              </button>
            </HelpTooltip>
          </>
        ) : null}
        {showMeshcoreGifButton && (
          <HelpTooltip text={t('chatPanel.meshcoreGifButtonHint')}>
            <button
              type="button"
              onClick={() => {
                setShowGifModal(true);
                setGifInput('');
                setGifPreviewFailed(false);
              }}
              disabled={disabled || !isConnected}
              aria-label={t('chatPanel.meshcoreGifButton')}
              className={emojiButtonClass}
            >
              GIF
            </button>
          </HelpTooltip>
        )}
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
          }}
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
