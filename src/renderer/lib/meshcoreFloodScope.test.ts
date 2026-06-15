import { describe, expect, it, vi } from 'vitest';

import {
  applyMeshcoreFloodScope,
  meshcoreFloodScopeKeyFromHashtag,
  normalizeMeshcoreFloodScopeHashtag,
} from './meshcoreFloodScope';

describe('meshcoreFloodScope', () => {
  it('normalizes hashtag with leading #', () => {
    expect(normalizeMeshcoreFloodScopeHashtag('colorado')).toBe('#colorado');
    expect(normalizeMeshcoreFloodScopeHashtag('#denver')).toBe('#denver');
    expect(normalizeMeshcoreFloodScopeHashtag('  ')).toBe('');
  });

  it('derives 16-byte key from hashtag', async () => {
    const key = await meshcoreFloodScopeKeyFromHashtag('#colorado');
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key?.length).toBe(16);
  });

  it('applyMeshcoreFloodScope calls setFloodScope or clearFloodScope', async () => {
    const setFloodScope = vi.fn().mockResolvedValue(undefined);
    const clearFloodScope = vi.fn().mockResolvedValue(undefined);
    const conn = { setFloodScope, clearFloodScope };

    await applyMeshcoreFloodScope(conn, '#colorado');
    expect(setFloodScope).toHaveBeenCalledTimes(1);
    expect(setFloodScope.mock.calls[0][0]).toBeInstanceOf(Uint8Array);

    await applyMeshcoreFloodScope(conn, '');
    expect(clearFloodScope).toHaveBeenCalledTimes(1);
  });
});
