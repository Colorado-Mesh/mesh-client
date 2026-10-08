import { describe, expect, it } from 'vitest';

import { validateLibreTranslationUrl } from './libreTranslationUrl';

describe('LibreTranslate URL', () => {
  it.each(['http://localhost:5000', 'http://[::1]:5000', 'https://translate.example/api/'])(
    'accepts explicit custom server %s',
    (url) => {
      expect(validateLibreTranslationUrl(url)).toBe(url.replace(/\/$/, ''));
    },
  );
  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://secret:password@server.test',
    'https://server.test/?api_key=secret',
    'https://server.test/#secret',
  ])('rejects %s', (url) => {
    expect(() => validateLibreTranslationUrl(url)).toThrow();
  });
});
