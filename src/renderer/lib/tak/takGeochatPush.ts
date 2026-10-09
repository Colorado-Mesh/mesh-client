import type { TAKGeochatMessage } from '@/shared/tak-types';

import { errLikeToLogString } from '../errLikeToLogString';

/** Fire-and-forget mirror of one heard channel message into TAK GeoChat. */
export function pushTakGeochat(msg: TAKGeochatMessage): void {
  window.electronAPI.tak.pushChatMessage(msg).catch((e: unknown) => {
    console.warn('[TakGeochat] pushChatMessage failed ' + errLikeToLogString(e));
  });
}
