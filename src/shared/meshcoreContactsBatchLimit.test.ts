// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  MESHCORE_CONTACTS_BATCH_MAX,
  meshcoreContactsBatchSliceCount,
} from './meshcoreContactsBatchLimit';

describe('meshcoreContactsBatchLimit', () => {
  it('exports IPC slice size of 500', () => {
    expect(MESHCORE_CONTACTS_BATCH_MAX).toBe(500);
  });

  it('meshcoreContactsBatchSliceCount matches ceil(total / max)', () => {
    expect(meshcoreContactsBatchSliceCount(0)).toBe(0);
    expect(meshcoreContactsBatchSliceCount(1)).toBe(1);
    expect(meshcoreContactsBatchSliceCount(500)).toBe(1);
    expect(meshcoreContactsBatchSliceCount(501)).toBe(2);
    expect(meshcoreContactsBatchSliceCount(688)).toBe(2);
    expect(meshcoreContactsBatchSliceCount(1000)).toBe(2);
    expect(meshcoreContactsBatchSliceCount(1001)).toBe(3);
  });

  it('meshcoreContactsBatchSliceCount returns 0 for invalid totals', () => {
    expect(meshcoreContactsBatchSliceCount(-1)).toBe(0);
    expect(meshcoreContactsBatchSliceCount(NaN)).toBe(0);
    expect(meshcoreContactsBatchSliceCount(Infinity)).toBe(0);
    expect(meshcoreContactsBatchSliceCount(1.5)).toBe(0);
  });
});
