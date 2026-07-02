import { describe, expect, it } from 'vitest';

import { buildFtsMatchQuery } from './messageFts';

describe('buildFtsMatchQuery', () => {
  it('returns null for empty input', () => {
    expect(buildFtsMatchQuery('')).toBeNull();
    expect(buildFtsMatchQuery('   ')).toBeNull();
  });

  it('builds prefix match tokens', () => {
    expect(buildFtsMatchQuery('hello world')).toBe('"hello"* "world"*');
  });

  it('strips fts special chars from tokens', () => {
    expect(buildFtsMatchQuery('foo*bar')).toBe('"foobar"*');
  });
});
