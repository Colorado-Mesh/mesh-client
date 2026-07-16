import { describe, expect, it } from 'vitest';

import { isRrcHubLinked } from './rrcHubSession';

describe('isRrcHubLinked', () => {
  it('treats connecting and active hubs as linked (focus-only, no reconnect)', () => {
    expect(isRrcHubLinked('active')).toBe(true);
    expect(isRrcHubLinked('reconnecting')).toBe(true);
    expect(isRrcHubLinked('connecting')).toBe(true);
    expect(isRrcHubLinked('awaiting_welcome')).toBe(true);
  });

  it('treats idle / disconnected hubs as not linked', () => {
    expect(isRrcHubLinked('disconnected')).toBe(false);
    expect(isRrcHubLinked(null)).toBe(false);
    expect(isRrcHubLinked(undefined)).toBe(false);
  });
});
