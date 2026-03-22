// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const INDEX_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8');

describe('IPC payload size limits (source contract)', () => {
  it('defines meshcore tcp-write and noble-ble limits and uses them in handlers', () => {
    expect(INDEX_SOURCE).toContain('const MESHCORE_TCP_WRITE_MAX_BYTES = 256 * 1024');
    expect(INDEX_SOURCE).toContain('const NOBLE_BLE_TO_RADIO_MAX_BYTES = 512');
    expect(INDEX_SOURCE).toMatch(/buf\.length > NOBLE_BLE_TO_RADIO_MAX_BYTES/);
    expect(INDEX_SOURCE).toMatch(/bytes\.length > MESHCORE_TCP_WRITE_MAX_BYTES/);
  });
});
