import { describe, expect, it } from 'vitest';

import { parseReticulumDeliveryMethod } from '@/shared/reticulumDeliveryMethod';

describe('parseReticulumDeliveryMethod', () => {
  it('accepts known methods case-insensitively', () => {
    expect(parseReticulumDeliveryMethod('direct')).toBe('direct');
    expect(parseReticulumDeliveryMethod('Propagated')).toBe('propagated');
    expect(parseReticulumDeliveryMethod('opportunistic')).toBe('opportunistic');
    expect(parseReticulumDeliveryMethod('paper')).toBe('paper');
  });

  it('rejects unknown or empty values', () => {
    expect(parseReticulumDeliveryMethod(undefined)).toBeUndefined();
    expect(parseReticulumDeliveryMethod(null)).toBeUndefined();
    expect(parseReticulumDeliveryMethod('')).toBeUndefined();
    expect(parseReticulumDeliveryMethod('garbage')).toBeUndefined();
  });
});
