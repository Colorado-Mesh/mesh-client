import { describe, expect, it } from 'vitest';

import { validateLibreTranslationUrl } from './libreTranslationUrl';

describe('LibreTranslate URL', () => {
  it.each([
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    'http://127.255.255.254:5000',
    'http://[::1]:5000',
    'https://translate.example/api/',
    'https://192.168.1.4:5000',
    'https://translate.local:5000',
  ])('accepts explicit custom server %s', (url) => {
    expect(validateLibreTranslationUrl(url)).toBe(url.replace(/\/$/, ''));
  });
  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://secret:password@server.test',
    'https://server.test/?api_key=secret',
    'https://server.test/#secret',
    'http://translate.example',
    'http://192.168.1.4:5000',
    'http://10.0.0.4:5000',
    'http://translate.local:5000',
    'http://localhost.example:5000',
    'http://localhost.:5000',
    'http://[fd00::1]:5000',
  ])('rejects %s', (url) => {
    expect(() => validateLibreTranslationUrl(url)).toThrow();
  });
});
