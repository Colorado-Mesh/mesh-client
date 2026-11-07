import type { ScheduledBroadcastTarget } from '@/shared/scheduledBroadcastTypes';

import {
  countMessageWireBytes,
  getComposerPayloadLimit,
  getMeshcoreRoomPayloadLimit,
} from '../chatComposerLimits';

/** RRC hub body budget used by ChatComposer / rrcSendBounded (UTF-8 bytes). */
export const RRC_HUB_BODY_LIMIT = 1800;

export interface TextLimitFailure {
  kind: ScheduledBroadcastTarget['kind'];
  label: string;
  limit: number;
  bytes: number;
}

/**
 * Single-packet text check for every enabled target. Returns failures (empty = ok).
 * Never suggests chunking — oversize always fails.
 */
export function validateBroadcastTextForTargets(
  text: string,
  targets: readonly ScheduledBroadcastTarget[],
  opts?: { meshtasticLongNameByIdentity?: Record<string, string | undefined> },
): TextLimitFailure[] {
  const trimmed = text.trim();
  const bytes = countMessageWireBytes(trimmed);
  const failures: TextLimitFailure[] = [];
  for (const t of targets) {
    if (!t.enabled) continue;
    let limit: number;
    if (t.kind === 'meshcore-room') {
      limit = getMeshcoreRoomPayloadLimit();
    } else if (t.kind === 'rrc-room') {
      limit = RRC_HUB_BODY_LIMIT;
    } else if (t.kind === 'meshcore-channel') {
      const name = opts?.meshtasticLongNameByIdentity?.[t.identityId] ?? '';
      // MeshCore channel limit depends on sender name; reserve max when unknown.
      limit = getComposerPayloadLimit({
        protocol: 'meshcore',
        senderDisplayName: name || 'X'.repeat(32),
      });
    } else {
      limit = getComposerPayloadLimit({ protocol: 'meshtastic' });
    }
    if (bytes > limit) {
      failures.push({ kind: t.kind, label: t.label, limit, bytes });
    }
  }
  return failures;
}

export function isBroadcastTextEmpty(text: string): boolean {
  return text.trim().length === 0;
}
