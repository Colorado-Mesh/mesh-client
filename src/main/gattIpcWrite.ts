import type { GattSessionProfile, GattSidecarProxy } from './gatt-sidecar-proxy';

export async function writeGattToRadio(
  proxy: Pick<GattSidecarProxy, 'isConnected' | 'toRadio'>,
  sessionId: GattSessionProfile,
  bytes: Uint8Array,
): Promise<void> {
  if (!(await proxy.isConnected(sessionId))) return;
  try {
    await proxy.toRadio(sessionId, bytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();
    if (
      lower.includes('disconnected') ||
      lower.includes('not connected') ||
      lower.includes('not currently connected')
    ) {
      console.debug(`[GATT:${sessionId}] disconnected during write`);
      return;
    }
    throw err;
  }
}
