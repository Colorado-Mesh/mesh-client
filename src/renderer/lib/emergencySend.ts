import type { OutboxEntry, OutboxEntryInput } from '@/shared/electron-api.types';

import { errLikeToLogString } from './errLikeToLogString';
import { withMeshtasticTextSendPacing } from './meshtasticTextSendPacing';

export interface EmergencySendDeps {
  isSendAvailable: boolean;
  sendFn: (
    text: string,
    channel: number,
    destination?: number,
    replyId?: number,
  ) => Promise<string | undefined> | string | undefined;
  queueOutbox: (entry: OutboxEntryInput) => Promise<OutboxEntry>;
  protocol: string;
  viewKey: string;
  channel: number;
  toNode: number | null;
  replyId?: number | null;
}

export type EmergencySendOutcome = 'sent' | 'queued';

/**
 * Send an emergency (MECP) text, falling back to the durable emergency-priority outbox when the
 * radio is unavailable or the live send throws. Mirrors ChatComposer's queue-on-failure path, but
 * rows are tagged `priority: 'emergency'` so they skip the 24h drain cap and retry indefinitely.
 * Failure point: `queueOutbox` rejecting — propagated so the caller can surface it (the message
 * is neither sent nor persisted).
 */
export function sendEmergencyText(
  text: string,
  deps: EmergencySendDeps,
): Promise<EmergencySendOutcome> {
  return sendTextWithOutboxFallback(text, deps, 'emergency');
}

/**
 * Same live-send / enqueue-on-failure path as {@link sendEmergencyText} with an explicit outbox
 * priority (quick-status presets and roll-call commands use `'normal'`).
 */
export async function sendTextWithOutboxFallback(
  text: string,
  deps: EmergencySendDeps,
  priority: 'normal' | 'emergency',
): Promise<EmergencySendOutcome> {
  const replyId = deps.replyId ?? null;
  const enqueue = async (): Promise<EmergencySendOutcome> => {
    await deps.queueOutbox({
      protocol: deps.protocol,
      viewKey: deps.viewKey,
      channel: deps.channel,
      toNode: deps.toNode,
      payload: text,
      replyId,
      status: 'queued',
      error: null,
      nextRetryAt: null,
      groupId: null,
      groupIndex: null,
      groupTotal: null,
      priority,
    });
    return 'queued';
  };

  if (!deps.isSendAvailable) return enqueue();

  const send = () =>
    Promise.resolve(
      deps.sendFn(text, deps.channel, deps.toNode ?? undefined, replyId ?? undefined),
    );
  try {
    if (deps.protocol === 'meshtastic') {
      await withMeshtasticTextSendPacing(send);
    } else {
      await send();
    }
    return 'sent';
  } catch (err: unknown) {
    console.warn(
      `[emergencySend] live send failed; queueing ${priority} outbox row: ` +
        errLikeToLogString(err),
    );
    return enqueue();
  }
}
