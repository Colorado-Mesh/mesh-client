import { describe, expect, it } from 'vitest';

import { parseHealthCheckCode } from './healthCheckCode';

describe('parseHealthCheckCode', () => {
  it.each([
    ['MHC-BBFDA0', 'MHC-BBFDA0'],
    ['MHC-3163e6', 'MHC-3163E6'],
    ['  mhc-298b99 ', 'MHC-298B99'],
  ])('parses %j', (text, code) => {
    expect(parseHealthCheckCode(text)).toBe(code);
  });

  it.each(['MHC-12345', 'MHC-1234567', 'MHC-GGGGGG', 'see MHC-ABCDEF', 'MHC-ABCDEF thanks', ''])(
    'rejects %j',
    (text) => {
      expect(parseHealthCheckCode(text)).toBeNull();
    },
  );
});
