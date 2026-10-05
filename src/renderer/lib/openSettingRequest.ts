import type { TabSlotId } from '@/renderer/lib/tabSlotIds';

/**
 * Lets deep components (e.g. a chat payload chip) ask App to open a panel and reveal a
 * settings-search anchor, the same jump the launcher performs, without prop drilling.
 */
export const OPEN_SETTING_REQUEST_EVENT = 'mesh-client:openSetting';

export interface OpenSettingRequest {
  slot: TabSlotId;
  /** Settings-search anchor id (`SettingSearchEntry.id`). */
  id: string;
}

export function requestOpenSetting(request: OpenSettingRequest): void {
  window.dispatchEvent(
    new CustomEvent<OpenSettingRequest>(OPEN_SETTING_REQUEST_EVENT, { detail: request }),
  );
}

export function subscribeOpenSettingRequests(
  listener: (request: OpenSettingRequest) => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<OpenSettingRequest | undefined>).detail;
    if (detail?.slot && detail.id) listener(detail);
  };
  window.addEventListener(OPEN_SETTING_REQUEST_EVENT, handler);
  return () => {
    window.removeEventListener(OPEN_SETTING_REQUEST_EVENT, handler);
  };
}
