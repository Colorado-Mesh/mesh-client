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

async function enqueueOutboxText(
  text: string,
  deps: EmergencySendDeps,
  priority: 'normal' | 'emergency',
): Promise<EmergencySendOutcome> {
  await deps.queueOutbox({
    protocol: deps.protocol,
    viewKey: deps.viewKey,
    channel: deps.channel,
    toNode: deps.toNode,
    payload: text,
    replyId: deps.replyId ?? null,
    status: 'queued',
    error: null,
    nextRetryAt: null,
    groupId: null,
    groupIndex: null,
    groupTotal: null,
    priority,
  });
  return 'queued';
}

/**
 * Queue an emergency (MECP) text on the durable emergency-priority outbox. The drain sends it
 * right away when the radio is up and only removes the row once the network acknowledges it
 * (`awaitNetworkAck`), retrying indefinitely until then; the row stays visible so the operator
 * can stop retries. `queueOutbox` must trigger a drain (`useChatOutbox.queue` does; other
 * callers use `requestChatOutboxDrain`).
 * Failure point: `queueOutbox` rejecting — propagated so the caller can surface it (the message
 * is neither sent nor persisted).
 */
export function sendEmergencyText(
  text: string,
  deps: EmergencySendDeps,
): Promise<EmergencySendOutcome> {
  return enqueueOutboxText(text, deps, 'emergency');
}

/**
 * Live send with enqueue-on-failure (radio unavailable or send throws).
 * Incident ACK uses `'normal'` so it does not compete with emergency reports.
 */
export async function sendTextWithOutboxFallback(
  text: string,
  deps: EmergencySendDeps,
  priority: 'normal' | 'emergency',
): Promise<EmergencySendOutcome> {
  const replyId = deps.replyId ?? null;
  const enqueue = (): Promise<EmergencySendOutcome> => enqueueOutboxText(text, deps, priority);

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
