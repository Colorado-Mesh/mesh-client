/**
 * Create an encrypted LXMF paper URI for a Reticulum DM and persist an outbound Chat row.
 */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { ingestReticulumLxmfPayloadWithSideEffects } from '@/renderer/lib/ingest/reticulumIngest';
import { extractLxmfPayloadFromSendResponse } from '@/renderer/lib/reticulum/lxmfSendResponse';
import type { IdentityId } from '@/renderer/lib/types';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';
import { paperErrorToI18n } from '@/shared/reticulumPaperErrors';

export type CreateReticulumPaperResult =
  { ok: true; uri: string; messageHash: string } | { ok: false; errorKey: string };

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

  const destinationHash = canonicalizeReticulumDestinationHash(opts.destinationHash);
  if (!destinationHash) {
    return { ok: false, errorKey: 'chatPanel.shareAsPaperFailed' };
  }

  try {
    const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/lxmf/paper/create', {
      destination_hash: destinationHash,
      text,
    })) as {
      ok?: boolean;
      error?: string;
      uri?: string;
      message_hash?: string;
      message?: unknown;
    };

    if (res.ok !== true || typeof res.uri !== 'string' || !res.uri) {
      const code = typeof res.error === 'string' ? res.error : '';
      return { ok: false, errorKey: paperErrorToI18n(code, 'create') };
    }

    const messageHash =
      typeof res.message_hash === 'string' && res.message_hash.trim()
        ? res.message_hash.trim()
        : null;
    if (!messageHash) {
      return { ok: false, errorKey: 'chatPanel.shareAsPaperFailed' };
    }

    const lxmfPayload = extractLxmfPayloadFromSendResponse(res);
    if (lxmfPayload) {
      ingestReticulumLxmfPayloadWithSideEffects(opts.identityId, lxmfPayload, {
        selfLxmfHash: lxmfPayload.sender_hash ?? undefined,
      });
    }

    return { ok: true, uri: res.uri, messageHash };
  } catch (err) {
    console.error('[createReticulumPaperMessage] failed: ' + errLikeToLogString(err));
    return { ok: false, errorKey: 'chatPanel.shareAsPaperFailed' };
  }
}
