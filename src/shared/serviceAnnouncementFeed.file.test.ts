import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseServiceAnnouncementFeedText,
  SERVICE_ANNOUNCEMENT_FEED_REPO_PATH,
  SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES,
} from './serviceAnnouncementFeed';

// Pre-commit appends this test whenever the feed is staged (scripts/precommit-tests.mjs).
describe(`committed ${SERVICE_ANNOUNCEMENT_FEED_REPO_PATH}`, () => {
  const raw = readFileSync(join(__dirname, '..', '..', SERVICE_ANNOUNCEMENT_FEED_REPO_PATH));

  it('fits the client size cap', () => {
    expect(raw.byteLength).toBeLessThanOrEqual(SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES);
  });

  it('parses with every row accepted (clients silently drop rejected rows)', () => {
    const result = parseServiceAnnouncementFeedText(raw.toString('utf8'));
    expect(result).toMatchObject({ ok: true, rejected: [] });
  });
});
