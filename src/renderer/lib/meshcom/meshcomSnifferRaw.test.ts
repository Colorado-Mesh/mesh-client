import { describe, expect, it } from 'vitest';

import { MESHCOM_MAX_TEXT_LEN } from '@/shared/meshcomConstants';

import {
  clampMeshcomSnifferRaw,
  MESHCOM_SNIFFER_RAW_MAX_BYTES,
  meshcomKissFrameRawSnippet,
} from './meshcomSnifferRaw';

describe('meshcomSnifferRaw', () => {
  it('leaves short captures unchanged', () => {
    const raw = new Uint8Array([1, 2, 3]);
    expect(clampMeshcomSnifferRaw(raw)).toBe(raw);
  });

  it('clamps oversized byte captures to MESHCOM_SNIFFER_RAW_MAX_BYTES', () => {
    const raw = new Uint8Array(MESHCOM_SNIFFER_RAW_MAX_BYTES + 50).fill(7);
    const clamped = clampMeshcomSnifferRaw(raw);
    expect(clamped.byteLength).toBe(MESHCOM_SNIFFER_RAW_MAX_BYTES);
    expect(clamped[0]).toBe(7);
  });

  it('truncates huge KISS info before encoding the sniffer snippet', () => {
    const info = 'x'.repeat(MESHCOM_MAX_TEXT_LEN + 8_000);
    const snippet = meshcomKissFrameRawSnippet({
      src: 'IK5NJM-11',
      dest: '*',
      info,
    });
    expect(snippet.byteLength).toBeLessThanOrEqual(MESHCOM_SNIFFER_RAW_MAX_BYTES);
    const decoded = new TextDecoder().decode(snippet);
    expect(decoded.startsWith('IK5NJM-11>*:')).toBe(true);
    expect(decoded.length).toBeLessThanOrEqual(MESHCOM_SNIFFER_RAW_MAX_BYTES);
  });
});
