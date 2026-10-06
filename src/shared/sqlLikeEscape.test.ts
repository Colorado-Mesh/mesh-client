import { describe, expect, it } from 'vitest';

import { escapeSqlLikePattern } from './sqlLikeEscape';

describe('escapeSqlLikePattern', () => {
  it('leaves strings without SQL LIKE wildcards untouched', () => {
    expect(escapeSqlLikePattern('hello world')).toBe('hello world');
    expect(escapeSqlLikePattern('node-1234')).toBe('node-1234');
    expect(escapeSqlLikePattern('')).toBe('');
  });

  it('escapes percentage sign (%)', () => {
    expect(escapeSqlLikePattern('100%')).toBe('100\\%');
    expect(escapeSqlLikePattern('%test%')).toBe('\\%test\\%');
  });

  it('escapes underscore sign (_)', () => {
    expect(escapeSqlLikePattern('user_name')).toBe('user\\_name');
    expect(escapeSqlLikePattern('__')).toBe('\\_\\_');
  });

  it('escapes backslash (\\)', () => {
    expect(escapeSqlLikePattern('C:\\path')).toBe('C:\\\\path');
    expect(escapeSqlLikePattern('\\')).toBe('\\\\');
  });

  it('correctly escapes combination of backslashes and wildcards', () => {
    expect(escapeSqlLikePattern('100%_done\\finish')).toBe('100\\%\\_done\\\\finish');
  });
});
