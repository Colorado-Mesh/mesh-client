import { describe, expect, it } from 'vitest';

import {
  formatLogId,
  isLogMessageId,
  LOG_MESSAGE_ID_RE,
  LOG_MESSAGE_IDS,
  nextLogMessageId,
} from './logMessageIds';

describe('logMessageIds', () => {
  it('registry keys match mcL#### and are unique', () => {
    const keys = Object.keys(LOG_MESSAGE_IDS);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(isLogMessageId(key)).toBe(true);
    }
  });

  it('formatLogId prefixes once', () => {
    expect(formatLogId('mcL0001', 'hello')).toBe('mcL0001 hello');
    expect(formatLogId('mcL0001', 'mcL0001 hello')).toBe('mcL0001 hello');
    expect(formatLogId('mcL0001', '')).toBe('mcL0001');
  });

  it('LOG_MESSAGE_ID_RE finds embedded tokens', () => {
    expect(LOG_MESSAGE_ID_RE.test('prefix mcL0042 rest')).toBe(true);
    expect(LOG_MESSAGE_ID_RE.test('no id here')).toBe(false);
  });

  it('nextLogMessageId advances past max', () => {
    expect(nextLogMessageId({ mcL0009: 'a', mcL0010: 'b' })).toBe('mcL0011');
  });
});
