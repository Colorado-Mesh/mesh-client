import { describe, expect, it } from 'vitest';

import { rrcReplyMention } from './rrcReplyMention';

describe('RRC reply mention', () => {
  it('prefixes the sender without losing a draft', () => {
    expect(rrcReplyMention('', 'Joey')).toBe('@Joey ');
    expect(rrcReplyMention('draft', 'Alice Smith')).toBe('@Alice Smith draft');
    expect(rrcReplyMention('', 'Joey 🛜')).toBe('@Joey 🛜 ');
    expect(rrcReplyMention('sounds good', 'Joey')).toBe('@Joey sounds good');
    expect(rrcReplyMention('@joey sounds good', 'Joey')).toBe('@joey sounds good');
  });
  it('rejects missing names, control characters and nested mentions', () => {
    expect(rrcReplyMention('draft', '')).toBeNull();
    expect(rrcReplyMention('draft', 'bad\nname')).toBeNull();
    expect(rrcReplyMention('draft', '@Joey')).toBeNull();
  });
});
