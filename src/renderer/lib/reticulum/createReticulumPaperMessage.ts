/**
 * Create an encrypted LXMF paper URI for a Reticulum DM and persist an outbound Chat row.
 */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  persistReticulumOutboundRecord,
  resolveReticulumOutboundSenderHash,
} from '@/renderer/lib/ingest/reticulumIngest';
import { reticulumHashToNodeId } from '@/renderer/lib/reticulum/destHash';
import { tryGetReticulumSession } from '@/renderer/lib/sessions/reticulumSession';
import type { IdentityId } from '@/renderer/lib/types';
import { addMessage, type MessageRecord } from '@/renderer/stores/messageStore';

export type CreateReticulumPaperResult =
  { ok: true; uri: string; messageHash: string } | { ok: false; errorKey: string };

const PAPER_CREATE_ERROR_KEYS: Record<string, string> = {
  identity_unknown: 'chatPanel.shareAsPaperIdentityUnknown',
  paper_too_large: 'chatPanel.shareAsPaperTooLarge',
  identity_not_configured: 'qrIngest.paperIdentityNotConfigured',
};

export async function createReticulumPaperMessage(opts: {
  identityId: IdentityId;
  destinationHash: string;
  text: string;
  channelIndex?: number;
}): Promise<CreateReticulumPaperResult> {
  const text = opts.text.trim();
  if (!text) {
    return { ok: false, errorKey: 'chatPanel.shareAsPaperEmpty' };
  }

  try {
    const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/lxmf/paper/create', {
      destination_hash: opts.destinationHash,
      text,
    })) as {
      ok?: boolean;
      error?: string;
      uri?: string;
      message_hash?: string;
      message?: {
        message_hash?: string;
        timestamp?: number;
        sender_name?: string;
      };
    };

    if (res.ok !== true || typeof res.uri !== 'string' || !res.uri) {
      const code = typeof res.error === 'string' ? res.error : '';
      return {
        ok: false,
        errorKey: PAPER_CREATE_ERROR_KEYS[code] ?? 'chatPanel.shareAsPaperFailed',
      };
    }

    const session = tryGetReticulumSession();
    const selfNodeId = session?.selfNodeId;
    if (session != null && typeof selfNodeId === 'number') {
      const messageHash =
        (typeof res.message_hash === 'string' && res.message_hash) ||
        (typeof res.message?.message_hash === 'string' && res.message.message_hash) ||
        `paper-${Date.now()}`;
      const toNodeId = reticulumHashToNodeId(opts.destinationHash) >>> 0;
      const senderHash = resolveReticulumOutboundSenderHash(selfNodeId) ?? '';
      const senderName = res.message?.sender_name?.trim() || session.getFullNodeLabel(selfNodeId);
      const record: MessageRecord = {
        id: messageHash,
        from: selfNodeId >>> 0,
        senderName,
        to: toNodeId,
        payload: text,
        channelIndex: opts.channelIndex ?? -1,
        timestamp: typeof res.message?.timestamp === 'number' ? res.message.timestamp : Date.now(),
        status: 'acked',
        receivedVia: 'paper',
        reticulumDeliveryMethod: 'paper',
        reticulumMessageHash: messageHash,
        reticulumSenderHash: senderHash || undefined,
      };
      addMessage(opts.identityId, record);
      persistReticulumOutboundRecord(
        opts.identityId,
        record,
        senderHash,
        senderName,
        opts.destinationHash,
        'acked',
      );
    }

    return {
      ok: true,
      uri: res.uri,
      messageHash:
        (typeof res.message_hash === 'string' && res.message_hash) || `paper-${Date.now()}`,
    };
  } catch (err) {
    console.error('[createReticulumPaperMessage] failed: ' + errLikeToLogString(err));
    return { ok: false, errorKey: 'chatPanel.shareAsPaperFailed' };
  }
}
