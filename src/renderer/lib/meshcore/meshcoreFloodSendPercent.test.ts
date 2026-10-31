import { describe, expect, it } from 'vitest';

import { meshcoreFloodSendPercent } from './meshcoreFloodSendPercent';

describe('meshcoreFloodSendPercent', () => {
  it('returns null when there are no sends', () => {
    expect(meshcoreFloodSendPercent(0, 0)).toBeNull();
  });

  it('rounds the flood share of lifetime TX mix', () => {
    expect(meshcoreFloodSendPercent(95, 5)).toBe(95);
    expect(meshcoreFloodSendPercent(19, 1)).toBe(95);
    expect(meshcoreFloodSendPercent(1, 1)).toBe(50);
    expect(meshcoreFloodSendPercent(0, 10)).toBe(0);
    expect(meshcoreFloodSendPercent(10, 0)).toBe(100);
  });
});
