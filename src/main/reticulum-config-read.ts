import fs from 'fs';

import { RETICULUM_CONFIG_MAX_READ_BYTES } from '../shared/reticulumProxyLimits';

/** Read a UTF-8 file with a byte cap to avoid main-process OOM on huge configs. */
export function readUtf8FileBounded(
  filePath: string,
  maxBytes = RETICULUM_CONFIG_MAX_READ_BYTES,
): string {
  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) {
    throw new Error(`config file exceeds ${maxBytes} byte limit`);
  }
  return fs.readFileSync(filePath, 'utf8');
}
