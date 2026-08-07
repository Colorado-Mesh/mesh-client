import { describe, expect, it } from 'vitest';

import {
  isPnCascadeDeliveryMethod,
  parseReticulumDeliveryMethod,
} from '@/shared/reticulumDeliveryMethod';

describe('parseReticulumDeliveryMethod', () => {
  it('accepts known methods case-insensitively', () => {
    expect(parseReticulumDeliveryMethod('direct')).toBe('direct');
    expect(parseReticulumDeliveryMethod('Propagated')).toBe('propagated');
    expect(parseReticulumDeliveryMethod('opportunistic')).toBe('opportunistic');
    expect(parseReticulumDeliveryMethod('paper')).toBe('paper');
    expect(parseReticulumDeliveryMethod('stored_locally')).toBe('stored_locally');
    expect(parseReticulumDeliveryMethod('Stored_Locally')).toBe('stored_locally');
  });

  it('rejects unknown or empty values', () => {
    expect(parseReticulumDeliveryMethod(undefined)).toBeUndefined();
    expect(parseReticulumDeliveryMethod(null)).toBeUndefined();
    expect(parseReticulumDeliveryMethod('')).toBeUndefined();
    expect(parseReticulumDeliveryMethod('garbage')).toBeUndefined();
  });
});

describe('isPnCascadeDeliveryMethod', () => {
  it('is true for propagated and stored_locally only', () => {
    expect(isPnCascadeDeliveryMethod('propagated')).toBe(true);
    expect(isPnCascadeDeliveryMethod('stored_locally')).toBe(true);
    expect(isPnCascadeDeliveryMethod('direct')).toBe(false);
    expect(isPnCascadeDeliveryMethod('paper')).toBe(false);
    expect(isPnCascadeDeliveryMethod(undefined)).toBe(false);
  });
});
