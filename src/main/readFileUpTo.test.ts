import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readFileUpTo } from './readFileUpTo';

describe('readFileUpTo', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'mesh-read-file-up-to-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads files at or below the byte limit', async () => {
    const filePath = path.join(tempDir, 'firmware.bin');
    writeFileSync(filePath, Buffer.from([1, 2, 3, 4]));

    await expect(readFileUpTo(filePath, 4)).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('rejects files exceeding the byte limit', async () => {
    const filePath = path.join(tempDir, 'firmware.bin');
    writeFileSync(filePath, Buffer.from([1, 2, 3, 4, 5]));

    await expect(readFileUpTo(filePath, 4)).rejects.toThrow('File too large');
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER])('rejects invalid maxBytes %s', async (maxBytes) => {
    const filePath = path.join(tempDir, 'firmware.bin');
    writeFileSync(filePath, Buffer.alloc(0));

    await expect(readFileUpTo(filePath, maxBytes)).rejects.toThrow(RangeError);
  });
});
