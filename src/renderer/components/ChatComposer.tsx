/* eslint-disable react-hooks/refs */
import 'emoji-picker-element';

import { ChevronDown, ChevronUp, CornerUpLeft, MapPin } from 'lucide-react-motion';
import { type RefObject, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { nodeDisplayName } from '@/renderer/lib/nodeLongNameOrHex';
import type { ChatMessage, MeshNode, MeshProtocol } from '@/renderer/lib/types';
import type { OutboxEntry, OutboxEntryInput } from '@/shared/electron-api.types';

import {
  isMeshcoreOpenWireCompatEnabled,
  isShareLocationSendWaypointEnabled,
} from '../lib/appSettingsStorage';
import {
  type ComposerWireContext,
  computeComposerLimitStatus,
  getComposerWireOverhead,
  MAX_CHUNKS,
  splitChatMessage,
} from '../lib/chatComposerLimits';
import { formatLocationMessage } from '../lib/chatLocationUtils';
import {
  clearDraft,
  FLOOD_SCOPE_OVERRIDE_UNSCOPED,
  loadDraftsInitial,
  loadFloodScopeOverridesInitial,
  saveDraft,
  saveFloodScopeOverride,
} from '../lib/chatPanelProtocolStorage';
import { normalizeMeshcoreFloodScopeHashtag } from '../lib/meshcoreFloodScope';
import {
  isValidMeshcoreFloodScopeHashtag,
  rememberMeshcoreFloodScopePreset,
} from '../lib/meshcoreFloodScopePresetsStorage';
import {
  formatMeshcoreGifWire,
  meshcoreGiphyMediaUrl,
  normalizeMeshcoreGifOutboundWire,
  parseMeshcoreGifId,
} from '../lib/meshcoreGifWire';
import { withMeshtasticTextSendPacing } from '../lib/meshtasticTextSendPacing';
import { HelpTooltip } from './HelpTooltip';
import MentionAutocomplete, { buildMentionCandidates } from './MentionAutocomplete';
import { useToast } from './Toast';

function emojiUnicodeFromEvent(event: Event): string | null {
  if (
    !(event instanceof CustomEvent) ||
    typeof event.detail !== 'object' ||
    event.detail === null
  ) {
    return null;
  }
  const detail = event.detail as Record<string, unknown>;
  if (typeof detail.emoji !== 'object' || detail.emoji === null) return null;
  const emoji = detail.emoji as Record<string, unknown>;
  return typeof emoji.unicode === 'string' ? emoji.unicode : null;
}

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
  /**
   * MeshCore: flood-scope hashtag for this send only (applied then radio default restored).
   * Composer UI remembers the selection per viewKey separately.
   */
  floodScopeOverride?: string;
}

export interface ChatComposerProps {
  protocol: MeshProtocol;
  viewKey: string;
  isConnected: boolean;
  connectionType?: 'ble' | 'serial' | 'http' | 'tcp' | null;
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
  /** Use LXMF message hash for reply threading (Reticulum). */
  lxmfReplyHashReplies?: boolean;
  /** MeshCore: show per-channel flood-scope override control (remembered per viewKey). */
  showFloodScopeOverride?: boolean;
  /** MeshCore: user-managed flood-scope quick-picks. */
  floodScopePresets?: string[];
  /**
   * MeshCore: remember a hashtag after a successful scoped send.
   * When omitted, Composer persists via the storage helper directly.
   */
  onRememberFloodScopePreset?: (hashtag: string) => void;
  /**
   * Resolve GPS/static position for one-click location share.
   * Sourced from runtime `refreshOurPosition` (Composer reads position via runtime, not nodeStore).
   */
  resolveShareLocation?: () => Promise<{ lat: number; lon: number } | null>;
  /**
   * Meshtastic dual-send: after the text location message, send a Waypoint packet.
   * Omitted / no-op for MeshCore and Reticulum. Channel is closed over by ChatPanel.
   */
  onSendLocationWaypoint?: (lat: number, lon: number) => Promise<void>;
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
  lxmfReplyHashReplies = false,
  showFloodScopeOverride = false,
  floodScopePresets = [],
  onRememberFloodScopePreset,
  resolveShareLocation,
  onSendLocationWaypoint,
  textareaRef,
  className,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const iconTrigger = useIconTrigger();
  const isLinux = useMemo(() => window.electronAPI.getPlatform() === 'linux', []);
  const limitHintId = useId();
  const counterLiveId = useId();
  const floodScopeListboxId = useId();
  const floodScopeCustomInputId = useId();

  const [input, setInput] = useState('');
  const [floodScopeOverride, setFloodScopeOverride] = useState('');
  const [floodScopeMenuOpen, setFloodScopeMenuOpen] = useState(false);
  const [floodScopeCustomEditing, setFloodScopeCustomEditing] = useState(false);
  const [floodScopeCustomDraft, setFloodScopeCustomDraft] = useState('');
  const [floodScopeCustomError, setFloodScopeCustomError] = useState<string | null>(null);
  const [floodScopeMenuPos, setFloodScopeMenuPos] = useState<{
    bottom: number;
    right: number;
  } | null>(null);
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
  const floodScopeMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const floodScopeMenuRef = useRef<HTMLDivElement | null>(null);
  const floodScopeSplitRef = useRef<HTMLDivElement | null>(null);
  const floodScopeCustomInputRef = useRef<HTMLInputElement | null>(null);
  const inputValueRef = useRef(input);
  inputValueRef.current = input;
  const floodScopeOverrideRef = useRef(floodScopeOverride);
  floodScopeOverrideRef.current = floodScopeOverride;
  const prevViewKeyRef = useRef<string | null>(null);

  const closeFloodScopeMenu = useCallback(() => {
    setFloodScopeMenuOpen(false);
    setFloodScopeMenuPos(null);
    setFloodScopeCustomEditing(false);
    setFloodScopeCustomDraft('');
    setFloodScopeCustomError(null);
  }, []);

  const persistFloodScopeOverride = useCallback(
    (next: string) => {
      setFloodScopeOverride(next);
      floodScopeOverrideRef.current = next;
      if (!showFloodScopeOverride) return;
      saveFloodScopeOverride(protocol, viewKey, next);
    },
    [protocol, showFloodScopeOverride, viewKey],
  );

  const commitCustomFloodScopeDraft = useCallback(() => {
    const normalized = normalizeMeshcoreFloodScopeHashtag(floodScopeCustomDraft);
    if (!isValidMeshcoreFloodScopeHashtag(normalized)) {
      setFloodScopeCustomError(t('chatPanel.floodScopeOverrideCustomInvalid'));
      return;
    }
    persistFloodScopeOverride(normalized);
    closeFloodScopeMenu();
  }, [closeFloodScopeMenu, floodScopeCustomDraft, persistFloodScopeOverride, t]);

  const rememberFloodScopeIfNeeded = useCallback(
    (override: string) => {
      // Default (`''`) and Unscoped must not enter the quick-pick list.
      if (!override || override === FLOOD_SCOPE_OVERRIDE_UNSCOPED) return;
      if (!isValidMeshcoreFloodScopeHashtag(override)) return;
      if (onRememberFloodScopePreset) {
        onRememberFloodScopePreset(override);
        return;
      }
      rememberMeshcoreFloodScopePreset(floodScopePresets, override);
    },
    [floodScopePresets, onRememberFloodScopePreset],
  );

  // Close flood-scope menu on outside click (split button + portaled menu).
  useEffect(() => {
    if (!floodScopeMenuOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        floodScopeSplitRef.current?.contains(target) ||
        floodScopeMenuRef.current?.contains(target)
      ) {
        return;
      }
      closeFloodScopeMenu();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [closeFloodScopeMenu, floodScopeMenuOpen]);

  // Close on scroll/resize so fixed menu does not drift from the trigger.
  useEffect(() => {
    if (!floodScopeMenuOpen) return;
    const handleDismiss = () => {
      closeFloodScopeMenu();
    };
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleDismiss);
    return () => {
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleDismiss);
    };
  }, [closeFloodScopeMenu, floodScopeMenuOpen]);

  useEffect(() => {
    if (!floodScopeCustomEditing) return;
    floodScopeCustomInputRef.current?.focus();
  }, [floodScopeCustomEditing]);

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

  // Draft + flood-scope persistence: save/restore when viewKey changes
  useEffect(() => {
    const prevKey = prevViewKeyRef.current;
    if (prevKey !== null && prevKey !== viewKey) {
      const currentInput = inputValueRef.current;
      if (currentInput.trim()) {
        saveDraft(protocol, prevKey, currentInput);
      } else {
        clearDraft(protocol, prevKey);
      }
      if (showFloodScopeOverride) {
        saveFloodScopeOverride(protocol, prevKey, floodScopeOverrideRef.current);
      }
    }
    prevViewKeyRef.current = viewKey;
    const drafts = loadDraftsInitial(protocol);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore per-view draft from localStorage on tab switch
    setInput(drafts[viewKey] ?? '');
    if (showFloodScopeOverride) {
      const overrides = loadFloodScopeOverridesInitial(protocol);
      const restored = overrides[viewKey] ?? '';
      setFloodScopeOverride(restored);
      floodScopeOverrideRef.current = restored;
    } else {
      setFloodScopeOverride('');
      floodScopeOverrideRef.current = '';
    }
    setMentionQuery(null);
    setChatActionError(null);
  }, [viewKey, protocol, showFloodScopeOverride]);

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
        const sendChunk = () =>
          onSendChunk(textsToSend[i], {
            replyId: i === 0 && typeof replyKey === 'number' ? replyKey : undefined,
            replyHash: i === 0 ? reticulumReplyHash : undefined,
            chunkIndex: i,
            floodScopeOverride:
              floodScopeOverride === FLOOD_SCOPE_OVERRIDE_UNSCOPED
                ? ''
                : floodScopeOverride
                  ? floodScopeOverride
                  : undefined,
          });
        // Shared Meshtastic TEXT_MESSAGE_APP pacing (with outbox drain) — firmware rejects
        // a second locally-originated text within ~2s (RATE_LIMIT_EXCEEDED).
        if (protocol === 'meshtastic') {
          await withMeshtasticTextSendPacing(sendChunk);
        } else {
          await sendChunk();
        }
      }
      rememberFloodScopeIfNeeded(floodScopeOverride);
      clearSentDraft(draftSnapshot);
      setMentionQuery(null);
      onReplyClear?.();
      onSendSuccess?.();
    } catch (err) {
      console.error('[ChatComposer] Send failed: ' + errLikeToLogString(err));
      const fallback = variant === 'room' ? t('roomsPanel.postFailed') : t('chatPanel.sendFailed');
      const errMsg = err instanceof Error ? err.message : fallback;
      if (allowOutbox && queueOutbox) {
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
      setChatActionError({
        message: errMsg,
        viewKey,
      });
    } finally {
      setSending(false);
    }
  }, [
    allowOutbox,
    clearSentDraft,
    disabled,
    floodScopeOverride,
    input,
    isConnected,
    isMqttOnly,
    limitStatus.singleMessageLimit,
    onReplyClear,
    onSendChunk,
    onSendSuccess,
    rememberFloodScopeIfNeeded,
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

  /** Enqueue shared-location text into the chat outbox; false when no enqueue fn is wired. */
  const enqueueLocationText = useCallback(
    async (text: string): Promise<boolean> => {
      const enqueue = queueOutboxProp ?? queueOutbox;
      if (!enqueue) return false;
      await enqueue({
        protocol,
        viewKey,
        channel: outboxChannel,
        toNode: outboxDestination ?? null,
        payload: text,
        replyId: null,
        status: 'queued',
        error: null,
        nextRetryAt: null,
        groupId: null,
        groupIndex: null,
        groupTotal: null,
      });
      return true;
    },
    [outboxChannel, outboxDestination, protocol, queueOutbox, queueOutboxProp, viewKey],
  );

  const handleShareLocation = useCallback(async () => {
    if (sending || disabled || !resolveShareLocation) return;
    if (!isConnected && !allowOutbox) {
      setChatActionError({
        message: t('chatPanel.composePlaceholderConnectFirst'),
        viewKey,
      });
      return;
    }
    setSending(true);
    setChatActionError(null);
    let text = '';
    try {
      const pos = await resolveShareLocation();
      if (pos == null) {
        addToast(t('chatPanel.shareLocationUnavailable'), 'warning');
        return;
      }
      text = formatLocationMessage(pos.lat, pos.lon, t('chatPanel.shareLocationLabel'));
      const shouldQueue = allowOutbox && (!isConnected || (isMqttOnly && protocol === 'meshcore'));
      if (shouldQueue) {
        if (await enqueueLocationText(text)) onSendSuccess?.();
        return;
      }
      await onSendChunk(text);
      if (
        protocol === 'meshtastic' &&
        isShareLocationSendWaypointEnabled() &&
        onSendLocationWaypoint &&
        isConnected
      ) {
        // Fire-and-forget: the waypoint wantAck promise can take up to 60s to
        // settle — do not hold the composer. Failure point: waypoint NAK/timeout;
        // fallback: text already sent, surface a warning toast only.
        void onSendLocationWaypoint(pos.lat, pos.lon).catch((wpErr: unknown) => {
          console.warn('[ChatComposer] location waypoint send failed ' + errLikeToLogString(wpErr));
          addToast(t('chatPanel.shareLocationWaypointFailed'), 'warning');
        });
      }
      onSendSuccess?.();
    } catch (err) {
      console.error('[ChatComposer] Share location failed: ' + errLikeToLogString(err));
      // Failure point: live send failed; fallback: enqueue text for later drain.
      try {
        if (allowOutbox && text && (await enqueueLocationText(text))) {
          onSendSuccess?.();
          return;
        }
      } catch (queueErr) {
        console.warn(
          '[ChatComposer] location outbox enqueue failed ' + errLikeToLogString(queueErr),
        );
      }
      setChatActionError({
        message: err instanceof Error ? err.message : t('chatPanel.sendFailed'),
        viewKey,
      });
    } finally {
      setSending(false);
    }
  }, [
    addToast,
    allowOutbox,
    disabled,
    enqueueLocationText,
    isConnected,
    isMqttOnly,
    onSendChunk,
    onSendLocationWaypoint,
    onSendSuccess,
    protocol,
    resolveShareLocation,
    sending,
    t,
    viewKey,
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
      const unicode = emojiUnicodeFromEvent(e);
      if (!unicode) return;
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

  const floodScopeOverrideActive = floodScopeOverride !== '';
  const floodScopeOverrideIndicator =
    floodScopeOverride === FLOOD_SCOPE_OVERRIDE_UNSCOPED
      ? t('chatPanel.floodScopeOverrideUnscoped')
      : floodScopeOverride || null;

  const sendButtonToneClass =
    variant === 'room'
      ? 'bg-brand-green/20 text-brand-green border-brand-green/40 hover:bg-brand-green/30 border text-sm font-medium disabled:opacity-40'
      : `font-medium transition-colors ${
          showQueueButton
            ? 'disabled:text-muted bg-slate-600 text-white hover:bg-slate-500 disabled:bg-gray-600'
            : isDmMode
              ? 'disabled:text-muted bg-purple-600 text-white hover:bg-purple-500 disabled:bg-gray-600'
              : 'disabled:text-muted bg-green-500 text-white hover:bg-green-400 disabled:bg-gray-600'
        }`;

  const sendButtonClass =
    variant === 'room'
      ? `${sendButtonToneClass} rounded px-4 py-2`
      : `${sendButtonToneClass} rounded-xl px-5 py-2.5`;

  const sendButtonSplitMainClass =
    variant === 'room'
      ? `${sendButtonToneClass} rounded-l border-r-0 px-4 py-2`
      : `${sendButtonToneClass} rounded-l-xl px-5 py-2.5`;

  const sendButtonSplitChevronClass =
    variant === 'room'
      ? `${sendButtonToneClass} rounded-r border-l border-l-black/20 px-1.5 py-2`
      : `${sendButtonToneClass} rounded-r-xl border-l border-l-black/20 px-1.5 py-2.5`;

  // Suppress the hover tooltip while the scope menu is open so it cannot cover the options.
  const floodScopeChevronTooltipProps = floodScopeMenuOpen ? { 'data-no-instant-tooltip': '' } : {};

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
  const showShareLocationButton = variant === 'chat' && typeof resolveShareLocation === 'function';

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
                void window.electronAPI.showEmojiPanel().catch((e: unknown) => {
                  console.debug('[ChatComposer] showEmojiPanel failed ' + errLikeToLogString(e));
                });
              }
            }}
            disabled={disabled || !isConnected}
            aria-label={t('chatPanel.emojiButton')}
            className={emojiButtonClass}
          >
            😊
          </button>
        </HelpTooltip>
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
        {showShareLocationButton && (
          <HelpTooltip text={t('chatPanel.shareLocationHint')}>
            <button
              type="button"
              onClick={() => {
                void handleShareLocation();
              }}
              disabled={disabled || (!isConnected && !allowOutbox) || sending}
              aria-label={t('chatPanel.shareLocation')}
              className={emojiButtonClass}
            >
              <MapPin aria-hidden className="h-4 w-4" trigger={iconTrigger} size={16} />
            </button>
          </HelpTooltip>
        )}
        {showFloodScopeOverride ? (
          <div ref={floodScopeSplitRef} className="inline-flex shrink-0 items-stretch">
            <span className="sr-only">{t('chatPanel.floodScopeOverrideLabel')}</span>
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
              className={sendButtonSplitMainClass}
            >
              {sendLabel}
            </button>
            <button
              ref={floodScopeMenuButtonRef}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onClick={() => {
                if (floodScopeMenuOpen) {
                  closeFloodScopeMenu();
                  return;
                }
                const button = floodScopeMenuButtonRef.current;
                if (button) {
                  const rect = button.getBoundingClientRect();
                  setFloodScopeMenuPos({
                    bottom: window.innerHeight - rect.top + 4,
                    right: window.innerWidth - rect.right,
                  });
                }
                setFloodScopeMenuOpen(true);
              }}
              disabled={disabled || sending}
              aria-label={
                floodScopeOverrideIndicator
                  ? `${t('chatPanel.floodScopeOverrideMenuButton')}: ${floodScopeOverrideIndicator}`
                  : t('chatPanel.floodScopeOverrideMenuButton')
              }
              aria-haspopup="listbox"
              aria-expanded={floodScopeMenuOpen}
              aria-controls={floodScopeMenuOpen ? floodScopeListboxId : undefined}
              title={floodScopeMenuOpen ? undefined : t('chatPanel.floodScopeOverrideHint')}
              {...floodScopeChevronTooltipProps}
              className={`${sendButtonSplitChevronClass} inline-flex max-w-[5.5rem] items-center gap-0.5`}
            >
              {floodScopeOverrideActive && floodScopeOverrideIndicator ? (
                <span className="truncate text-[10px] leading-none font-normal">
                  {floodScopeOverrideIndicator}
                </span>
              ) : null}
              {floodScopeMenuOpen ? (
                <ChevronUp
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0"
                  trigger={iconTrigger}
                  size={14}
                />
              ) : (
                <ChevronDown
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0"
                  trigger={iconTrigger}
                  size={14}
                />
              )}
            </button>
            {floodScopeMenuOpen && floodScopeMenuPos
              ? createPortal(
                  <div
                    ref={floodScopeMenuRef}
                    style={{
                      position: 'fixed',
                      bottom: floodScopeMenuPos.bottom,
                      right: floodScopeMenuPos.right,
                    }}
                    className="bg-deep-black z-50 max-h-72 min-w-[12rem] overflow-y-auto rounded-lg border border-gray-700 py-1 shadow-xl"
                  >
                    {floodScopeCustomEditing ? (
                      <div className="space-y-2 px-2 py-1.5">
                        <label
                          className="text-muted block text-[10px]"
                          htmlFor={floodScopeCustomInputId}
                        >
                          {t('chatPanel.floodScopeOverrideCustomLabel')}
                        </label>
                        <input
                          id={floodScopeCustomInputId}
                          type="text"
                          value={floodScopeCustomDraft}
                          onChange={(e) => {
                            setFloodScopeCustomDraft(e.target.value);
                            setFloodScopeCustomError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setFloodScopeCustomEditing(false);
                              setFloodScopeCustomDraft('');
                              setFloodScopeCustomError(null);
                              return;
                            }
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitCustomFloodScopeDraft();
                            }
                          }}
                          ref={floodScopeCustomInputRef}
                          placeholder={t('chatPanel.floodScopeOverrideCustomPlaceholder')}
                          aria-label={t('chatPanel.floodScopeOverrideCustomLabel')}
                          className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 focus:outline-none"
                        />
                        {floodScopeCustomError ? (
                          <p role="alert" className="text-[10px] text-red-400">
                            {floodScopeCustomError}
                          </p>
                        ) : null}
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setFloodScopeCustomEditing(false);
                              setFloodScopeCustomDraft('');
                              setFloodScopeCustomError(null);
                            }}
                            className="text-muted rounded px-2 py-1 text-[10px] hover:text-gray-200"
                          >
                            {t('common.cancel')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              commitCustomFloodScopeDraft();
                            }}
                            className="bg-brand-green/20 text-brand-green hover:bg-brand-green/30 rounded px-2 py-1 text-[10px] font-medium"
                          >
                            {t('chatPanel.floodScopeOverrideCustomApply')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <ul
                        id={floodScopeListboxId}
                        role="listbox"
                        aria-label={t('chatPanel.floodScopeOverrideAria')}
                      >
                        {(
                          [
                            { value: '', label: t('chatPanel.floodScopeOverrideDefault') },
                            ...floodScopePresets.map((tag) => ({
                              value: tag,
                              label: tag,
                            })),
                            {
                              value: FLOOD_SCOPE_OVERRIDE_UNSCOPED,
                              label: t('chatPanel.floodScopeOverrideUnscoped'),
                            },
                          ] as const
                        ).map((option) => {
                          const selected = floodScopeOverride === option.value;
                          return (
                            <li
                              key={option.value || '__default__'}
                              role="option"
                              aria-selected={selected}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  persistFloodScopeOverride(option.value);
                                  closeFloodScopeMenu();
                                }}
                                className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                  selected
                                    ? 'text-brand-green bg-gray-800'
                                    : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
                                }`}
                              >
                                {option.label}
                              </button>
                            </li>
                          );
                        })}
                        <li role="presentation" className="mt-1 border-t border-gray-700 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setFloodScopeCustomEditing(true);
                              setFloodScopeCustomDraft(
                                floodScopeOverride &&
                                  floodScopeOverride !== FLOOD_SCOPE_OVERRIDE_UNSCOPED &&
                                  !floodScopePresets.includes(floodScopeOverride)
                                  ? floodScopeOverride
                                  : '',
                              );
                              setFloodScopeCustomError(null);
                            }}
                            className="w-full px-3 py-1.5 text-left text-xs text-cyan-300 transition-colors hover:bg-gray-800 hover:text-cyan-200"
                          >
                            {t('chatPanel.floodScopeOverrideCustom')}
                          </button>
                        </li>
                      </ul>
                    )}
                  </div>,
                  document.body,
                )
              : null}
          </div>
        ) : (
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
        )}
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
