import type { MeshDevice } from '@meshtastic/core';

/** SDK Xmodem keeps rx data in a private buffer — read after downloadFile settles. */
interface XmodemInternal {
  rxBuffer: Uint8Array[];
  txBuffer: Uint8Array[];
}

function xmodemInternal(device: MeshDevice): XmodemInternal {
  return device.xModem as unknown as XmodemInternal;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const XMODEM_POLL_MS = 200;
const XMODEM_DOWNLOAD_TIMEOUT_MS = 120_000;

/** Upload bytes to the connected Meshtastic device via firmware XMODEM. */
export async function meshtasticXmodemUpload(
  device: MeshDevice,
  filename: string,
  data: Uint8Array,
): Promise<void> {
  const result = await device.xModem.uploadFile(filename, data);
  if (result !== 0) {
    throw new Error(`XMODEM upload rejected (code ${result})`);
  }
}

/**
 * Request a file from the device and wait for rx chunks.
 * Failure point: radio timeout — throws after {@link XMODEM_DOWNLOAD_TIMEOUT_MS}.
 */
export async function meshtasticXmodemDownload(
  device: MeshDevice,
  filename: string,
): Promise<Uint8Array> {
  const internal = xmodemInternal(device);
  internal.rxBuffer = [];
  const started = Date.now();
  const kickoff = device.xModem.downloadFile(filename);
  while (Date.now() - started < XMODEM_DOWNLOAD_TIMEOUT_MS) {
    const chunks = internal.rxBuffer.filter((c) => c && c.length > 0);
    if (chunks.length > 0) {
      const result = await kickoff;
      if (result !== 0) {
        throw new Error(`XMODEM download rejected (code ${result})`);
      }
      return concatChunks(chunks);
    }
    await new Promise((r) => setTimeout(r, XMODEM_POLL_MS));
  }
  throw new Error('XMODEM download timed out');
}
