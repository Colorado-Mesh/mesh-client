import { hydrateMecpBlockedSenders } from '@/renderer/stores/mecpBlockStore';
import { hydrateReticulumDismissedContacts } from '@/renderer/stores/reticulumPeerStore';
import { hydrateTakRelayPrefs } from '@/renderer/stores/takRelayPrefsStore';
import { hydrateWeatherFilterPreferences } from '@/renderer/stores/weatherFilterStore';
import { MS_PER_SECOND } from '@/shared/timeConstants';

import { hydrateChatLastRead } from './chatPanelProtocolStorage';
import { errLikeToLogString } from './errLikeToLogString';
import { hydrateRendererPreferences } from './rendererPreferences';
import { flushRendererStorageDeletions } from './rendererStorage';
import { hydrateRrcLastRead } from './rrcReadWatermark';

const READ_RETRY_DELAYS_MS = [0, 250, MS_PER_SECOND];
let hydration: Promise<void> | undefined;

async function hydrateFromDatabase(): Promise<void> {
  await flushRendererStorageDeletions();
  let settings: Record<string, string> | undefined;
  // Bound the startup delay, but recover from temporary SQLite/IPC failures before App mounts.
  for (const delayMs of READ_RETRY_DELAYS_MS) {
    if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    try {
      settings = await window.electronAPI.appSettings.getAll();
      break;
    } catch (error) {
      console.warn(
        '[hydrateDurableRendererSettings] SQLite read failed',
        errLikeToLogString(error),
      );
    }
  }
  // Exhausted reads keep the adapters unhydrated and their local journals intact. Never seed
  // defaults over an unread database; another explicit hydration or next launch can retry.
  if (settings === undefined) throw new Error('Saved settings database unavailable');
  await hydrateRendererPreferences(settings);
  hydrateWeatherFilterPreferences();
  hydrateReticulumDismissedContacts();
  const results = await Promise.allSettled([
    hydrateChatLastRead(settings),
    hydrateRrcLastRead(settings),
    hydrateMecpBlockedSenders(settings),
    hydrateTakRelayPrefs(settings),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(
        '[hydrateDurableRendererSettings] hydration failed',
        errLikeToLogString(result.reason),
      );
    }
  }
}

/** Finish before mounting App: its stores and effects must see SQLite's initial values. */
export function hydrateDurableRendererSettings(): Promise<void> {
  hydration ??= hydrateFromDatabase().finally(() => {
    hydration = undefined;
  });
  return hydration;
}
