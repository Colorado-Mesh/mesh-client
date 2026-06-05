import { upsertMessage, useMessageStore } from '../../stores/messageStore';
import {
  meshcoreChannelRepairRawText,
  resolveMeshcoreChannelMessageSender,
} from '../meshcoreChannelText';
import { messageRecordToChatMessage } from '../storeRecordAdapters';
import type { IdentityId } from '../types';

/** Re-resolve channel rows that arrived before contact/pubkey maps were ready. */
export function repairMeshcoreChannelSenderIdsInStore(identityId: IdentityId): void {
  const byId = useMessageStore.getState().messages[identityId];
  if (!byId) return;

  const patches: Parameters<typeof upsertMessage>[1][] = [];
  for (const record of Object.values(byId)) {
    if (record.from !== 0 || record.channelIndex < 0) continue;
    const chat = messageRecordToChatMessage(record);
    const resolved = resolveMeshcoreChannelMessageSender({
      rawText: meshcoreChannelRepairRawText(chat),
    });
    if (resolved.senderId <= 0 || resolved.senderId === record.from) continue;
    patches.push({
      ...record,
      from: resolved.senderId,
      ...(resolved.displayName ? { senderName: resolved.displayName } : {}),
    });
  }
  for (const patch of patches) {
    upsertMessage(identityId, patch);
  }
}
