import type { NobleSessionId } from './noble-ble-manager';

export interface NobleBleWriter {
  isConnected(sessionId: NobleSessionId): boolean;
  writeToRadio(sessionId: NobleSessionId, bytes: Buffer): Promise<void>;
}

export function isExpectedNobleDisconnectError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    /\bdisconnected\b(?:\s*[:#-]?\s*\d+)?/.test(message) ||
    message.includes('not connected') ||
    message.includes('not currently connected')
  );
}

export async function handleNobleBleToRadioWrite(args: {
  sessionId: NobleSessionId;
  bytes: unknown;
  isQuitting: boolean;
  maxBytes: number;
  manager: NobleBleWriter;
}): Promise<'ignored-quitting' | 'ignored-disconnected' | 'ignored-expected-disconnect' | 'wrote'> {
  const { bytes, isQuitting, manager, maxBytes, sessionId } = args;
  if (isQuitting) return 'ignored-quitting';
  if (!manager.isConnected(sessionId)) return 'ignored-disconnected';
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as Uint8Array);
  if (buf.length > maxBytes) {
    throw new Error(`noble-ble-to-radio: payload exceeds ${maxBytes} bytes (${buf.length})`);
  }
  try {
    await manager.writeToRadio(sessionId, buf);
    return 'wrote';
  } catch (err) {
    if (isExpectedNobleDisconnectError(err)) return 'ignored-expected-disconnect';
    throw err;
  }
}
