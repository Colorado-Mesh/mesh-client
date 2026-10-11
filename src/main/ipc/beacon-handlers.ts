import {
  type Event,
  ipcMain,
  type WebContents,
  type WebContentsDidStartNavigationEventParams,
} from 'electron';

import { BEACON_STATUS_PUBLIC_HTTPS_REJECTED } from '../../shared/beacon';
import { BeaconFeedClient, parseBeaconConnectRequest } from '../beacon-feed';
import { assertIpcSender } from '../validate-ipc-sender';

/** Each renderer owns one opt-in feed, disposed on navigation, destruction, or disconnect. */
export function registerBeaconIpcHandlers(): void {
  const clients = new Map<number, { client: BeaconFeedClient; dispose: () => void }>();
  const disconnect = (sender: WebContents): void => {
    const active = clients.get(sender.id);
    if (!active) return;
    clients.delete(sender.id);
    active.dispose();
  };

  ipcMain.handle('beacon:connect', async (event, raw: unknown) => {
    assertIpcSender(event, 'beacon:connect');
    const sender = event.sender;
    let currentClient: BeaconFeedClient | null = null;
    try {
      const request = parseBeaconConnectRequest(raw);
      disconnect(sender);
      const client = new BeaconFeedClient((update) => {
        if (!sender.isDestroyed() && clients.get(sender.id)?.client === client) {
          sender.send('beacon:update', update);
        }
      });
      currentClient = client;
      const onDestroyed = (): void => {
        disconnect(sender);
      };
      const onNavigate = (details: Event<WebContentsDidStartNavigationEventParams>): void => {
        if (details.isMainFrame && !details.isSameDocument) disconnect(sender);
      };
      const dispose = (): void => {
        sender.removeListener('destroyed', onDestroyed);
        sender.removeListener('did-start-navigation', onNavigate);
        sender.removeListener('render-process-gone', onDestroyed);
        client.disconnect();
      };
      clients.set(sender.id, { client, dispose });
      sender.once('destroyed', onDestroyed);
      sender.on('did-start-navigation', onNavigate);
      sender.on('render-process-gone', onDestroyed);
      await client.connect(request);
      return { ok: true };
    } catch {
      // catch-no-log-ok Fixed UI error avoids logging user URLs or remote response contents.
      if (currentClient && clients.get(sender.id)?.client === currentClient) disconnect(sender);
      return { ok: false, error: BEACON_STATUS_PUBLIC_HTTPS_REJECTED };
    }
  });

  ipcMain.handle('beacon:disconnect', (event) => {
    assertIpcSender(event, 'beacon:disconnect');
    disconnect(event.sender);
  });
}
