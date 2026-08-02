import { errLikeToLogString } from './errLikeToLogString';

/**
 * Once-only disconnect helper for BLE reconnect budget timeouts.
 * Catch may run before `opened` is assigned; late open/attach must still tear down the driver.
 */
export function createBleReconnectTransportCleanup(
  disconnect: (identityId: string) => Promise<void>,
  logTag: string,
): {
  cleanup: (identityId: string | null | undefined) => Promise<void>;
  cleanedIdentityId: () => string | null;
} {
  let cleanedIdentityId: string | null = null;
  return {
    cleanedIdentityId: () => cleanedIdentityId,
    async cleanup(identityId: string | null | undefined): Promise<void> {
      if (!identityId || cleanedIdentityId === identityId) return;
      cleanedIdentityId = identityId;
      await disconnect(identityId).catch((e: unknown) => {
        console.debug(`[${logTag}] late reconnect transport disconnect ` + errLikeToLogString(e));
      });
    },
  };
}
