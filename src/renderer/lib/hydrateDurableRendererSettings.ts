import { hydrateMecpBlockedSenders } from '@/renderer/stores/mecpBlockStore';
import { hydrateTakRelayPrefs } from '@/renderer/stores/takRelayPrefsStore';

import { hydrateChatLastRead } from './chatPanelProtocolStorage';
import { errLikeToLogString } from './errLikeToLogString';
import { hydrateRrcLastRead } from './rrcReadWatermark';

/** Finish before mounting App: its stores and effects must see SQLite's initial values. */
export async function hydrateDurableRendererSettings(): Promise<void> {
  let settings: Record<string, string>;
  try {
    settings = await window.electronAPI.appSettings.getAll();
  } catch (error) {
    // Leave writes queued locally; a failed read must never seed over an existing DB value.
    console.warn('[hydrateDurableRendererSettings] SQLite read failed', errLikeToLogString(error));
    return;
  }
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
