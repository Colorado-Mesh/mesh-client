import { describe, expect, it } from 'vitest';

import {
  clearLinkTimeoutDestProcessed,
  markLinkTimeoutDestProcessed,
  normalizeLinkTimeoutDestHash,
  shouldSkipLinkTimeoutDest,
} from '@/renderer/lib/reticulum/reticulumLinkTimeoutBridgeDedup';

const DEST = 'ac978c7786832dc2edff1d4782541cbe';

describe('reticulumLinkTimeoutBridgeDedup', () => {
  it('normalizes hex and rejects short hashes for skip/mark', () => {
    expect(normalizeLinkTimeoutDestHash(` ${DEST.toUpperCase()} `)).toBe(DEST);
    const processed = new Set<string>();
    expect(shouldSkipLinkTimeoutDest(processed, 'abcd')).toBe(true);
    expect(markLinkTimeoutDestProcessed(processed, 'abcd')).toBeNull();
    expect(processed.size).toBe(0);
  });

  it('marks and skips until cleared for a new outbound', () => {
    const processed = new Set<string>();
    expect(shouldSkipLinkTimeoutDest(processed, DEST)).toBe(false);
    expect(markLinkTimeoutDestProcessed(processed, DEST)).toBe(DEST);
    expect(shouldSkipLinkTimeoutDest(processed, DEST)).toBe(true);
    // Second send to same dest must re-enable the bridge.
    clearLinkTimeoutDestProcessed(processed, DEST);
    expect(shouldSkipLinkTimeoutDest(processed, DEST)).toBe(false);
    expect(markLinkTimeoutDestProcessed(processed, DEST)).toBe(DEST);
    expect(shouldSkipLinkTimeoutDest(processed, DEST)).toBe(true);
  });
});
