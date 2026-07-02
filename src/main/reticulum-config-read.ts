import fs from 'fs';

import { RETICULUM_CONFIG_MAX_READ_BYTES } from '../shared/reticulumProxyLimits';

/** Read a UTF-8 file with a byte cap to avoid main-process OOM on huge configs. */
export function readUtf8FileBounded(
  filePath: string,
  maxBytes = RETICULUM_CONFIG_MAX_READ_BYTES,
): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(maxBytes + 1);
    const bytesRead = fs.readSync(fd, buf, 0, maxBytes + 1, 0);
    if (bytesRead > maxBytes) {
      throw new Error(`config file exceeds ${maxBytes} byte limit`);
    }
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}
