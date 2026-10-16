import type { TAKChannelChatMessage } from '@/shared/tak-types';

import { errLikeToLogString } from '../errLikeToLogString';

/** Fire-and-forget hand-off of one heard channel message to TAK clients. */
export function pushTakGeochat(msg: TAKChannelChatMessage): void {
  window.electronAPI.tak.pushChatMessage(msg).catch((e: unknown) => {
    console.warn('[TakGeochat] pushChatMessage failed ' + errLikeToLogString(e));
  });
}
