import {
  type MessageRecord,
  subscribeMessageStoreEvents,
  useMessageStore,
} from '../../stores/messageStore';
import type { IdentityId } from '../types';

/** Either lookup level can miss (identity never sent, row evicted or mid-rename). */
function bucketOf(identityId: IdentityId): Record<string, MessageRecord | undefined> | undefined {
  return useMessageStore.getState().messages[identityId];
}

function recordOf(identityId: IdentityId, id: string): MessageRecord | undefined {
  return bucketOf(identityId)?.[id];
}

/**
 * Wait until an outbound chat row leaves `sending`.
 *
 * Resolves `true` on `acked`, `false` on `failed`, a vanished row, or `timeoutMs`. Follows
 * provisional → packet id re-keys (`renameMessageId`) so the wait survives the id swap that
 * happens when the radio accepts the frame.
 */
export function waitForChatSettlement(
  identityId: IdentityId,
  messageId: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let currentId = messageId;
    let done = false;

    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribeStore();
      unsubscribeEvents();
      resolve(ok);
    };

    const check = (): void => {
      if (done) return;
      const record = recordOf(identityId, currentId);
      if (!record) return; // May be mid-rename or not yet inserted; the timeout bounds the wait.
      if (record.status === 'acked') finish(true);
      else if (record.status === 'failed') finish(false);
    };

    const timer = setTimeout(
      () => {
        finish(false);
      },
      Math.max(0, timeoutMs),
    );
    const unsubscribeStore = useMessageStore.subscribe(check);
    const unsubscribeEvents = subscribeMessageStoreEvents((event) => {
      if (
        event.type === 'renamed' &&
        event.identityId === identityId &&
        event.fromId === currentId
      ) {
        currentId = event.toId;
        // The store write already happened (events fire after setState); re-check now.
        check();
      }
    });
    check();
  });
}
