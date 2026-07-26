import { open } from 'node:fs/promises';

/**
 * Read at most `maxBytes` from a user-selected file.
 *
 * The same file descriptor is used for the size check and read, avoiding a
 * stat/read race if the selected path is replaced while the dialog closes.
 */
export async function readFileUpTo(filePath: string, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('maxBytes must be a non-negative safe integer');
  }

  const file = await open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) {
      throw new Error('File too large');
    }
    return buffer.subarray(0, offset);
  } finally {
    await file.close();
  }
}
