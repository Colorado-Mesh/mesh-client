import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import i18n from '@/renderer/lib/i18n';
import {
  ingestReticulumLxmfPayloadWithSideEffects,
  persistReticulumOutboundRecord,
  resolveReticulumOutboundSenderHash,
  type ReticulumLxmfPayload,
} from '@/renderer/lib/ingest/reticulumIngest';
import { flushPendingReticulumOutboundDeliveryStatus } from '@/renderer/lib/reticulum/applyReticulumOutboundDeliveryStatus';
import {
  resolveReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import { cacheReticulumVoiceMemoOgg } from '@/renderer/lib/reticulum/reticulumAudioAttachmentCache';
import { shouldDeletePriorReticulumOutboundHash } from '@/renderer/lib/reticulum/reticulumOutboundRetry';
import { stopReticulumVoiceMemoRecorder } from '@/renderer/lib/reticulum/reticulumVoiceMemo';
import {
  resolveReticulumOutboundVia,
  tryGetReticulumSession,
} from '@/renderer/lib/sessions/reticulumSession';
import type { IdentityId } from '@/renderer/lib/types';
import {
  addMessage,
  type MessageRecord,
  renameMessageId,
  updateMessageStatus,
  useMessageStore,
} from '@/renderer/stores/messageStore';
import { reticulumHashForNodeId } from '@/renderer/stores/reticulumPeerStore';
import { useReticulumVoiceMemoStore } from '@/renderer/stores/reticulumVoiceMemoStore';
import {
  LXMF_AUDIO_MODE_OPUS_OGG,
  VOICE_MEMO_MAX_OGG_BYTES,
} from '@/shared/reticulum-voice-memo-types';

function resolveDestHash(destination: number | undefined): string | null {
  if (destination == null) return null;
  return reticulumHashForNodeId(destination) ?? resolveReticulumDestinationHash(destination);
}

export interface SendReticulumVoiceMemoOpts {
  identityId: IdentityId;
  destination?: number;
  onOversize: () => void;
  onNoPropagationNode: () => void;
  onTooLargeForPropagation?: () => void;
}

/**
 * Stop the active memo recording (if needed), encode via sidecar, and send LXMF
 * with native FIELD_AUDIO. Optimistic pending row uses `[voice:<ms>]`.
 */
export function sendReticulumVoiceMemo(opts: SendReticulumVoiceMemoOpts): boolean {
  const { identityId, destination, onOversize, onNoPropagationNode, onTooLargeForPropagation } =
    opts;

  const session = tryGetReticulumSession();
  if (!session) {
    console.warn('[sendReticulumVoiceMemo] Reticulum runtime not mounted');
    useReticulumVoiceMemoStore.getState().reset();
    return false;
  }

  const destHash = resolveDestHash(destination);
  if (!destHash) {
    console.warn('[sendReticulumVoiceMemo] no destination hash');
    useReticulumVoiceMemoStore.getState().reset();
    return false;
  }

  const selfNodeId = session.selfNodeId;
  if (typeof selfNodeId !== 'number') {
    console.warn('[sendReticulumVoiceMemo] self node id not ready');
    useReticulumVoiceMemoStore.getState().reset();
    return false;
  }

  const memoStore = useReticulumVoiceMemoStore.getState();
  const existingOgg = memoStore.oggBase64;
  const existingDurationMs = memoStore.durationMs;

  useReticulumVoiceMemoStore.getState().setSending();

  void (async () => {
    let oggBase64: string;
    let durationMs: number;
    let statusId = `reticulum-pending-voice-${Date.now()}`;

    if (existingOgg && existingDurationMs != null) {
      oggBase64 = existingOgg;
      durationMs = existingDurationMs;
    } else {
      const sessionId = await stopReticulumVoiceMemoRecorder();
      if (!sessionId) {
        useReticulumVoiceMemoStore.getState().reset();
        return;
      }
      try {
        const res = await window.electronAPI.reticulum.voiceMemo.stop({ session_id: sessionId });
        if (!res.ok || !res.ogg_base64) {
          useReticulumVoiceMemoStore.getState().setError(res.error ?? 'stop_failed');
          return;
        }
        oggBase64 = res.ogg_base64;
        durationMs = res.duration_ms ?? 0;
        useReticulumVoiceMemoStore.getState().applyStopResult({
          oggBase64,
          durationMs,
          sizeBytes: res.size_bytes ?? 0,
        });
      } catch (e) {
        console.warn('[sendReticulumVoiceMemo] stop failed:', errLikeToLogString(e));
        useReticulumVoiceMemoStore.getState().setError('stop_failed');
        return;
      }
    }

    const rawBytes = Math.round((oggBase64.length * 3) / 4);
    if (rawBytes > VOICE_MEMO_MAX_OGG_BYTES) {
      console.warn('[sendReticulumVoiceMemo] Ogg too large:', rawBytes, 'bytes');
      onOversize();
      useReticulumVoiceMemoStore.getState().reset();
      return;
    }

    const attachmentPath = await cacheReticulumVoiceMemoOgg(oggBase64, {
      fileNamePrefix: 'voice-memo-out',
    });
    if (!attachmentPath) {
      console.warn('[sendReticulumVoiceMemo] local Ogg cache failed — aborting send');
      useReticulumVoiceMemoStore.getState().setError('cache_failed');
      return;
    }

    const text = `[voice:${durationMs}]`;
    const receivedVia = resolveReticulumOutboundVia(destHash);
    const senderName = session.getFullNodeLabel(selfNodeId);
    const senderHash = resolveReticulumOutboundSenderHash(selfNodeId);
    const toNodeId = (destination ?? reticulumHashToNodeId(destHash)) >>> 0;
    const pendingId = statusId;
    const record: MessageRecord = {
      id: pendingId,
      from: selfNodeId >>> 0,
      senderName,
      to: toNodeId,
      payload: text,
      channelIndex: 0,
      timestamp: Date.now(),
      status: 'sending',
      receivedVia,
      reticulumAudioMode: LXMF_AUDIO_MODE_OPUS_OGG,
      reticulumAttachmentKind: 'audio',
      reticulumAudioDurationSec: durationMs / 1000,
      reticulumAttachmentPath: attachmentPath,
    };

    addMessage(identityId, record);
    if (senderHash) {
      persistReticulumOutboundRecord(
        identityId,
        record,
        senderHash,
        senderName,
        destHash,
        'sending',
      );
    }

    try {
      const body = {
        destination_hash: destHash,
        text,
        audio: { mode: LXMF_AUDIO_MODE_OPUS_OGG, data_base64: oggBase64 },
      };
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/lxmf/send', body)) as {
        ok?: boolean;
        error?: string;
        message?: ReticulumLxmfPayload;
      };

      if (res.ok === false) {
        const err = res.error ?? 'lxmf_send_failed';
        if (err === 'no_propagation_node') {
          onNoPropagationNode();
          updateMessageStatus(
            identityId,
            pendingId,
            'failed',
            i18n.t('chatPanel.reticulumNoPropagationNode'),
          );
        } else if (err === 'message_too_large_for_propagation') {
          onTooLargeForPropagation?.();
          updateMessageStatus(identityId, pendingId, 'failed', err);
        } else {
          updateMessageStatus(identityId, pendingId, 'failed', err);
        }
        useReticulumVoiceMemoStore.getState().reset();
        return;
      }

      const lxmfPayload = res.message;
      const hash = lxmfPayload?.message_hash;
      if (!lxmfPayload || !hash) {
        updateMessageStatus(identityId, pendingId, 'failed', 'missing_message_hash');
        useReticulumVoiceMemoStore.getState().reset();
        return;
      }

      renameMessageId(identityId, pendingId, hash);
      statusId = hash;
      const replacesMessageHash = shouldDeletePriorReticulumOutboundHash(pendingId, hash)
        ? pendingId
        : undefined;
      ingestReticulumLxmfPayloadWithSideEffects(identityId, lxmfPayload, {
        selfLxmfHash: senderHash ?? undefined,
        replacesMessageHash,
        attachmentPath,
        attachmentKind: 'audio',
        audioMode: LXMF_AUDIO_MODE_OPUS_OGG,
      });
      // Re-persist final hash with attachment path: an early WS Completes insert can
      // land first without a path; SQLite UPDATE now coalesces, but only if we pass it.
      if (senderHash) {
        const finalRow = useMessageStore.getState().messages[identityId][hash];
        persistReticulumOutboundRecord(
          identityId,
          {
            ...finalRow,
            reticulumAttachmentPath: attachmentPath,
            reticulumAttachmentKind: 'audio',
            reticulumAudioMode: LXMF_AUDIO_MODE_OPUS_OGG,
            reticulumAudioDurationSec: durationMs / 1000,
          },
          senderHash,
          senderName,
          destHash,
          finalRow.status === 'acked' ? 'acked' : 'sending',
          replacesMessageHash,
        );
      }
      flushPendingReticulumOutboundDeliveryStatus(identityId, hash);
      const afterFlush = useMessageStore.getState().messages[identityId][hash].status;
      if (afterFlush !== 'acked' && afterFlush !== 'failed') {
        updateMessageStatus(identityId, hash, 'sending');
      }
    } catch (e) {
      const errMsg = errLikeToLogString(e);
      console.warn('[sendReticulumVoiceMemo] send failed:', errMsg);
      if (errMsg.includes('no_propagation_node')) {
        onNoPropagationNode();
      }
      if (errMsg.includes('message_too_large_for_propagation')) {
        onTooLargeForPropagation?.();
      }
      updateMessageStatus(identityId, statusId, 'failed', errMsg);
    }

    useReticulumVoiceMemoStore.getState().reset();
  })();

  return true;
}
