import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'loadNotificationSoundPlayWav.ts'),
  'utf8',
);

describe('loadNotificationSoundPlayWav', () => {
  it('loads the production sibling chunk and exposes a test cache reset', () => {
    expect(SOURCE).toContain("path.join(__dirname, 'notification-sound-play-wav.js')");
    expect(SOURCE).toContain('loadRegisterNotificationSoundPlayWavIpc');
    expect(SOURCE).toContain('resetPlayNotificationSoundWavCacheForTests');
  });
});
