/** BLE errors tagged by Web Bluetooth / connection layer when pairing is the likely cause. */
export interface PairingRelatedError extends Error {
  isPairingRelated: true;
}

export function markPairingRelatedError(message: string, isPairing: boolean): Error {
  const error = new Error(message);
  if (isPairing) {
    (error as PairingRelatedError).isPairingRelated = true;
  }
  return error;
}

export function isPairingRelatedError(err: unknown): err is PairingRelatedError {
  return (
    err instanceof Error &&
    'isPairingRelated' in err &&
    (err as PairingRelatedError).isPairingRelated
  );
}
