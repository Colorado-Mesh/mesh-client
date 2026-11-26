/**
 * Connect-time MeshCore channel snapshot.
 *
 * `meshcore.js` `getChannels()` reads index 0, 1, 2… until the companion answers `Err`, then
 * resolves with whatever it has. Its `Err` listener is connection-wide, so **any** error from a
 * concurrent companion RPC (self-info, contacts, an unsupported command) truncates the list to
 * zero even though the radio has channels. An empty channel table is never legitimate: firmware
 * always exposes at least channel 0 (Public), so re-read before accepting it.
 */

const MESHCORE_CHANNEL_READ_ATTEMPTS = 3;
const MESHCORE_CHANNEL_RETRY_DELAY_MS = 400;

export interface ReadMeshcoreChannelsOptions {
  /** Setup-generation guard; checked between attempts and before each re-read. */
  isCancelled?: () => boolean;
  attempts?: number;
  delayMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function readMeshcoreChannelsWithRetry<T>(
  readOnce: () => Promise<readonly T[]>,
  options: ReadMeshcoreChannelsOptions = {},
): Promise<readonly T[]> {
  const attempts = Math.max(1, options.attempts ?? MESHCORE_CHANNEL_READ_ATTEMPTS);
  const delayMs = Math.max(0, options.delayMs ?? MESHCORE_CHANNEL_RETRY_DELAY_MS);
  const isCancelled = options.isCancelled ?? (() => false);

  let channels = await readOnce();
  for (let attempt = 1; attempt < attempts && channels.length === 0; attempt++) {
    if (isCancelled()) return channels;
    if (delayMs > 0) await delay(delayMs);
    if (isCancelled()) return channels;
    channels = await readOnce();
  }
  return channels;
}
