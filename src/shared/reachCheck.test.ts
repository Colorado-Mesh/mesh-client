import { describe, expect, it } from 'vitest';

import { normalizeReachCheckOrigin } from './reachCheck';

describe('normalizeReachCheckOrigin', () => {
  it('normalizes a full page address to its origin', () => {
    expect(
      normalizeReachCheckOrigin('  https://rangecheck.example.org/app?x=1#top ', {
        allowLocal: false,
      }),
    ).toEqual({ ok: true, origin: 'https://rangecheck.example.org' });
  });

  it('accepts an explicit port 443', () => {
    expect(
      normalizeReachCheckOrigin('https://healthcheck.example.org:443/', { allowLocal: false }),
    ).toEqual({ ok: true, origin: 'https://healthcheck.example.org' });
  });

  it.each([
    ['http://healthcheck.example.org', 'invalid_url'],
    ['https://user:secret@healthcheck.example.org', 'invalid_url'],
    ['https://healthcheck.example.org:8443', 'invalid_url'],
    ['not a url', 'invalid_url'],
    ['', 'invalid_url'],
    ['ftp://healthcheck.example.org', 'invalid_url'],
    ['https://10.0.0.5', 'not_public'],
    ['https://[2001:db8::1]', 'not_public'],
    ['https://healthcheck.local', 'not_public'],
    ['https://box.localhost', 'not_public'],
    ['https://svc.internal', 'not_public'],
    ['https://intranet', 'not_public'],
  ])('refuses %s as %s', (raw, error) => {
    expect(normalizeReachCheckOrigin(raw, { allowLocal: false })).toEqual({ ok: false, error });
  });

  it('refuses an address longer than 2048 characters', () => {
    const raw = `https://healthcheck.example.org/${'a'.repeat(2100)}`;
    expect(normalizeReachCheckOrigin(raw, { allowLocal: false })).toEqual({
      ok: false,
      error: 'invalid_url',
    });
  });

  it('allows a local http server only when allowLocal is set', () => {
    expect(normalizeReachCheckOrigin('http://127.0.0.1:3090/app', { allowLocal: true })).toEqual({
      ok: true,
      origin: 'http://127.0.0.1:3090',
    });
    expect(normalizeReachCheckOrigin('http://localhost:3090', { allowLocal: true })).toEqual({
      ok: true,
      origin: 'http://localhost:3090',
    });
    expect(normalizeReachCheckOrigin('http://127.0.0.1:3090', { allowLocal: false })).toEqual({
      ok: false,
      error: 'invalid_url',
    });
  });

  it('keeps refusing non-local http even when allowLocal is set', () => {
    expect(
      normalizeReachCheckOrigin('http://healthcheck.example.org', { allowLocal: true }),
    ).toEqual({
      ok: false,
      error: 'invalid_url',
    });
    expect(normalizeReachCheckOrigin('http://127.0.0.1', { allowLocal: true })).toEqual({
      ok: false,
      error: 'invalid_url',
    });
  });
});
