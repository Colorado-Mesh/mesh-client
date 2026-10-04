// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  diffAnnouncements,
  formatAnnouncementWarning,
  readAnnouncementRows,
} from './check-service-announcements.mjs';

const feed = (...rows) => JSON.stringify({ schema: 1, announcements: rows });
const row = { id: 'maint', severity: 'info', title: 'Maintenance', body: 'Body' };

describe('readAnnouncementRows', () => {
  it.each([null, '', '  \n'])('treats %j as an empty feed', (text) => {
    const r = readAnnouncementRows(text);
    expect(r.ok && r.rows.size).toBe(0);
  });

  it.each([
    ['{', /valid JSON/],
    ['[]', /object/],
    ['{"schema":1}', /array/],
  ])('rejects %j', (text, reason) => {
    const r = readAnnouncementRows(text);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(reason);
  });

  it('keys rows without an id by position', () => {
    const r = readAnnouncementRows(feed(row, { title: 'no id' }));
    expect([...r.rows.keys()]).toEqual(['maint', '#1']);
  });
});

describe('diffAnnouncements', () => {
  it('reports nothing for an unchanged or empty-to-empty feed', () => {
    const d = diffAnnouncements(feed(row), feed(row));
    expect(formatAnnouncementWarning(d)).toBe('');
    expect(formatAnnouncementWarning(diffAnnouncements(null, feed()))).toBe('');
  });

  it('detects added, changed, and removed announcements', () => {
    const d = diffAnnouncements(
      feed(row, { ...row, id: 'old', title: 'Old one' }),
      feed({ ...row, body: 'Edited' }, { ...row, id: 'new', title: 'Brand new' }),
    );
    expect(d).toMatchObject({ ok: true, added: ['new'], changed: ['maint'], removed: ['old'] });
    const warning = formatAnnouncementWarning(d);
    expect(warning).toContain('EVERY mesh-client user');
    expect(warning).toContain('new: "Brand new"');
    expect(warning).toContain('Removed (retracted from users)');
    expect(warning).toContain('old: "Old one"');
  });

  it('treats a brand-new feed file as all added', () => {
    const d = diffAnnouncements(null, feed(row));
    expect(d.ok && d.added).toEqual(['maint']);
  });

  it('lets a commit fix a previously broken HEAD feed', () => {
    const d = diffAnnouncements('{broken', feed(row));
    expect(d.ok && d.added).toEqual(['maint']);
  });

  it('blocks a malformed staged feed', () => {
    const d = diffAnnouncements(feed(row), '{"schema":1,"announcements":[}');
    expect(d.ok).toBe(false);
  });
});
