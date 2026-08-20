/**
 * After one full BLE reconnect budget is exhausted, latch auto-reconnect off until the user
 * (or power/adapter recovery) explicitly clears it. Prevents late Noble disconnect cleanup from
 * starting a new 1/N cycle forever when the peripheral is gone.
 */

export interface BleReconnectExhaustLatch {
  isExhausted(): boolean;
  markExhausted(): void;
  clear(): void;
}

export function createBleReconnectExhaustLatch(): BleReconnectExhaustLatch {
  let exhausted = false;
  return {
    isExhausted: () => exhausted,
    markExhausted: () => {
      exhausted = true;
    },
    clear: () => {
      exhausted = false;
    },
  };
}

/**
 * Guard for connection-lost / Noble disconnect / yield-nudge paths.
 * Returns true when the caller should skip starting a new reconnect owner.
 */
export function shouldSkipBleReconnectAfterExhaustion(opts: {
  bleExhausted: boolean;
  isReconnecting: boolean;
}): boolean {
  if (!opts.bleExhausted) return false;
  if (opts.isReconnecting) return false;
  return true;
}

/**
 * Extra guard: ignore late Noble disconnects after UI already shows disconnect+loss.
 */
export function shouldIgnoreNobleDisconnectForReconnect(opts: {
  isReconnecting: boolean;
  connectionStatus: string | null | undefined;
  connectionLoss: boolean | null | undefined;
}): boolean {
  if (opts.isReconnecting) return false;
  return opts.connectionStatus === 'disconnected' && opts.connectionLoss === true;
}
