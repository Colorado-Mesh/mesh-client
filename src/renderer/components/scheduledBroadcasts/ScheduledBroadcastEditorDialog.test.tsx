import { describe, expect, it } from 'vitest';

import { hhMmToMins, minsToHhMm } from './ScheduledBroadcastEditorDialog';

describe('ScheduledBroadcastEditorDialog time helpers', () => {
  it('round-trips HH:MM through minutes', () => {
    expect(minsToHhMm(540)).toBe('09:00');
    expect(hhMmToMins('09:00')).toBe(540);
    expect(hhMmToMins('9:30')).toBe(9 * 60 + 30);
  });

  it('accepts HH:MM:SS from browsers that include seconds', () => {
    expect(hhMmToMins('09:30:00')).toBe(9 * 60 + 30);
    expect(hhMmToMins('23:59:59')).toBe(23 * 60 + 59);
  });

  it('rejects incomplete or out-of-range values without forcing a rewrite', () => {
    expect(hhMmToMins('')).toBeNull();
    expect(hhMmToMins('09:')).toBeNull();
    expect(hhMmToMins('24:00')).toBeNull();
    expect(hhMmToMins('12:60')).toBeNull();
  });
});
