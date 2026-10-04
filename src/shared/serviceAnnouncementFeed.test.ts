import { describe, expect, it } from 'vitest';

import {
  filterActiveServiceAnnouncements,
  parseHttpsUrl,
  parseServiceAnnouncementFeed,
  parseServiceAnnouncementFeedText,
  resolveServiceAnnouncementText,
  SERVICE_ANNOUNCEMENT_BODY_MAX,
  SERVICE_ANNOUNCEMENT_MAX_ENTRIES,
  SERVICE_ANNOUNCEMENT_TITLE_MAX,
  type ServiceAnnouncement,
} from './serviceAnnouncementFeed';

const valid = {
  id: 'backbone-maintenance',
  severity: 'warning',
  title: 'Backbone maintenance',
  body: 'Line one.\nLine two.',
};

function feed(...rows: unknown[]): unknown {
  return { schema: 1, announcements: rows };
}

function okList(data: unknown): ServiceAnnouncement[] {
  const r = parseServiceAnnouncementFeed(data);
  if (!r.ok) throw new Error(r.reason);
  return r.announcements;
}

describe('parseServiceAnnouncementFeedText', () => {
  it.each(['', '   ', '\n\t\n'])('treats empty text %j as an empty feed', (text) => {
    expect(parseServiceAnnouncementFeedText(text)).toEqual({
      ok: true,
      announcements: [],
      rejected: [],
    });
  });

  it.each(['{', 'not json', '{"schema":1,"announcements":[}', '<html>404</html>'])(
    'reports malformed JSON %j without throwing',
    (text) => {
      const r = parseServiceAnnouncementFeedText(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/invalid JSON/);
    },
  );

  it('parses a valid document', () => {
    const r = parseServiceAnnouncementFeedText(JSON.stringify(feed(valid)));
    expect(r.ok && r.announcements.map((a) => a.id)).toEqual(['backbone-maintenance']);
  });
});

describe('parseServiceAnnouncementFeed shape', () => {
  it.each([
    [null, /object/],
    [[], /object/],
    ['x', /object/],
    [42, /object/],
    [{ announcements: [] }, /schema/],
    [{ schema: 2, announcements: [] }, /schema/],
    [{ schema: '1', announcements: [] }, /schema/],
    [{ schema: 1 }, /array/],
    [{ schema: 1, announcements: {} }, /array/],
  ])('rejects %j', (data, reason) => {
    const r = parseServiceAnnouncementFeed(data);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });

  it('accepts an empty list', () => {
    expect(okList(feed())).toEqual([]);
  });
});

describe('parseServiceAnnouncementFeed rows', () => {
  it('keeps valid rows and rejects bad ones individually', () => {
    const r = parseServiceAnnouncementFeed(
      feed(valid, null, 'str', { ...valid, id: 'Bad_Id' }, { ...valid, id: 'second' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.announcements.map((a) => a.id)).toEqual(['backbone-maintenance', 'second']);
    expect(r.rejected.map((x) => x.index)).toEqual([1, 2, 3]);
  });

  it.each([
    ['id missing', { ...valid, id: undefined }],
    ['id too long', { ...valid, id: 'a'.repeat(65) }],
    ['id leading dash', { ...valid, id: '-x' }],
    ['severity unknown', { ...valid, severity: 'urgent' }],
    ['title empty', { ...valid, title: '   ' }],
    ['title too long', { ...valid, title: 'x'.repeat(SERVICE_ANNOUNCEMENT_TITLE_MAX + 1) }],
    ['body missing', { ...valid, body: undefined }],
    ['body too long', { ...valid, body: 'x'.repeat(SERVICE_ANNOUNCEMENT_BODY_MAX + 1) }],
    ['url http', { ...valid, url: 'http://example.com' }],
    ['url javascript', { ...valid, url: 'javascript:alert(1)' }],
    ['url credentials', { ...valid, url: 'https://u:p@example.com' }],
    ['url not string', { ...valid, url: 5 }],
    ['startsAt bad', { ...valid, startsAt: 'tomorrow' }],
    ['expiresAt bad', { ...valid, expiresAt: 123 }],
    ['startsAt without zone', { ...valid, startsAt: '2026-10-08T00:00:00' }],
    ['startsAt date only', { ...valid, startsAt: '2026-10-08' }],
    ['expiresAt RFC 2822', { ...valid, expiresAt: 'Thu, 08 Oct 2026 00:00:00 GMT' }],
    ['expiresAt impossible date', { ...valid, expiresAt: '2026-13-45T00:00:00Z' }],
    ['startsAt Feb 30 overflow', { ...valid, startsAt: '2026-02-30T00:00:00Z' }],
    ['startsAt Feb 29 in non-leap year', { ...valid, startsAt: '2025-02-29T00:00Z' }],
    ['expiresAt Apr 31 overflow', { ...valid, expiresAt: '2026-04-31T12:00:00+02:00' }],
    ['expiresAt Feb 31 overflow', { ...valid, expiresAt: '2026-02-31T00:00:00Z' }],
    ['expiresAt junk between prefix and zone', { ...valid, expiresAt: '2026-10-08T06:00junkZ' }],
    [
      'expires before starts',
      { ...valid, startsAt: '2026-02-01T00:00:00Z', expiresAt: '2026-01-01T00:00:00Z' },
    ],
    ['minAppVersion bad', { ...valid, minAppVersion: '6.0' }],
    ['maxAppVersion bad', { ...valid, maxAppVersion: 'v6.0.0' }],
    ['localized not object', { ...valid, localized: [] }],
    ['localized bad key', { ...valid, localized: { 'not a locale': { title: 'x' } } }],
    ['localized bad value', { ...valid, localized: { es: { title: 7 } } }],
  ])('rejects row with %s', (_label, row) => {
    const r = parseServiceAnnouncementFeed(feed(row));
    expect(r.ok && r.announcements).toEqual([]);
    expect(r.ok && r.rejected).toHaveLength(1);
  });

  it('rejects duplicate ids after the first', () => {
    const r = parseServiceAnnouncementFeed(feed(valid, { ...valid, title: 'dupe' }));
    expect(r.ok && r.announcements.map((a) => a.title)).toEqual(['Backbone maintenance']);
    expect(r.ok && r.rejected[0]?.reason).toMatch(/duplicate/);
  });

  it(`caps the feed at ${SERVICE_ANNOUNCEMENT_MAX_ENTRIES} entries`, () => {
    const rows = Array.from({ length: SERVICE_ANNOUNCEMENT_MAX_ENTRIES + 3 }, (_, i) => ({
      ...valid,
      id: `n-${i}`,
    }));
    const r = parseServiceAnnouncementFeed(feed(...rows));
    expect(r.ok && r.announcements).toHaveLength(SERVICE_ANNOUNCEMENT_MAX_ENTRIES);
    expect(r.ok && r.rejected).toHaveLength(3);
  });

  it('trims text, normalizes url, ignores unknown fields, drops urlLabel without url', () => {
    const [a] = okList(
      feed(
        { ...valid, title: '  Padded  ', url: 'https://Example.com/x', urlLabel: 'Go', extra: 1 },
        { ...valid, id: 'no-url', urlLabel: 'Orphan' },
      ),
    );
    expect(a).toEqual({
      id: 'backbone-maintenance',
      severity: 'warning',
      title: 'Padded',
      body: 'Line one.\nLine two.',
      url: 'https://example.com/x',
      urlLabel: 'Go',
    });
    expect(okList(feed({ ...valid, id: 'no-url', urlLabel: 'Orphan' }))[0]?.urlLabel).toBe(
      undefined,
    );
  });

  it('does not let a __proto__ locale key reach the prototype', () => {
    const data = JSON.parse(
      JSON.stringify(feed(valid)).replace(
        '"body"',
        '"localized":{"__proto__":{"title":"x"}},"body"',
      ),
    ) as unknown;
    const r = parseServiceAnnouncementFeed(data);
    expect(r.ok && r.announcements).toEqual([]);
    expect(({} as Record<string, unknown>).title).toBeUndefined();
  });
});

describe('timestamp zones', () => {
  it.each([
    '2026-10-08T06:00:00Z',
    '2026-10-08T00:00:00-06:00',
    '2026-10-08T06:00Z',
    '2026-10-08T06:00:00.250Z',
    '2024-02-29T00:00:00Z',
  ])('accepts %s', (startsAt) => {
    expect(okList(feed({ ...valid, startsAt }))[0]?.startsAt).toBe(startsAt);
  });

  it('treats an offset and its UTC equivalent as the same instant', () => {
    const list = okList(
      feed(
        { ...valid, id: 'utc', expiresAt: '2026-10-08T06:00:00Z' },
        { ...valid, id: 'offset', expiresAt: '2026-10-08T00:00:00-06:00' },
      ),
    );
    const ids = (nowMs: number) =>
      filterActiveServiceAnnouncements(list, { nowMs, appVersion: '6.0.0' }).map((a) => a.id);
    expect(ids(Date.parse('2026-10-08T05:59:59Z'))).toEqual(['utc', 'offset']);
    expect(ids(Date.parse('2026-10-08T06:00:00Z'))).toEqual([]);
  });
});

describe('filterActiveServiceAnnouncements', () => {
  const nowMs = Date.parse('2026-06-15T12:00:00Z');
  const list = okList(
    feed(
      { ...valid, id: 'always' },
      { ...valid, id: 'future', startsAt: '2026-07-01T00:00:00Z' },
      { ...valid, id: 'expired', expiresAt: '2026-06-01T00:00:00Z' },
      {
        ...valid,
        id: 'window',
        startsAt: '2026-06-01T00:00:00Z',
        expiresAt: '2026-07-01T00:00:00Z',
      },
      { ...valid, id: 'needs-7', minAppVersion: '7.0.0' },
      { ...valid, id: 'old-only', maxAppVersion: '5.9.9' },
      { ...valid, id: 'exact', minAppVersion: '6.0.0', maxAppVersion: '6.0.0' },
    ),
  );

  it('applies date and version gates', () => {
    expect(
      filterActiveServiceAnnouncements(list, { nowMs, appVersion: '6.0.0' }).map((a) => a.id),
    ).toEqual(['always', 'window', 'exact']);
  });

  it('ignores a prerelease suffix on the app version', () => {
    expect(
      filterActiveServiceAnnouncements(list, { nowMs, appVersion: '6.0.0-beta.2' }).map(
        (a) => a.id,
      ),
    ).toEqual(['always', 'window', 'exact']);
  });

  it('skips version gates when the app version is unparsable', () => {
    expect(
      filterActiveServiceAnnouncements(list, { nowMs, appVersion: 'dev' }).map((a) => a.id),
    ).toEqual(['always', 'window', 'needs-7', 'old-only', 'exact']);
  });
});

describe('resolveServiceAnnouncementText', () => {
  const a = okList(
    feed({
      ...valid,
      url: 'https://example.com',
      urlLabel: 'Read more',
      localized: { es: { title: 'Mantenimiento' }, 'pt-BR': { body: 'Corpo' } },
    }),
  ).at(0);
  if (!a) throw new Error('fixture');

  it('falls back to English fields', () => {
    expect(resolveServiceAnnouncementText(a, 'de')).toEqual({
      title: 'Backbone maintenance',
      body: 'Line one.\nLine two.',
      urlLabel: 'Read more',
    });
  });

  it('uses the base language and per-field fallback', () => {
    expect(resolveServiceAnnouncementText(a, 'es-MX').title).toBe('Mantenimiento');
    expect(resolveServiceAnnouncementText(a, 'es-MX').body).toBe('Line one.\nLine two.');
    expect(resolveServiceAnnouncementText(a, 'pt-BR').body).toBe('Corpo');
  });
});

describe('parseHttpsUrl', () => {
  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['http://example.com', null],
    ['file:///etc/passwd', null],
    ['not a url', null],
    [undefined, null],
  ])('%j -> %j', (raw, expected) => {
    expect(parseHttpsUrl(raw)).toBe(expected);
  });
});
