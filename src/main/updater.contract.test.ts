// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const UPDATER_SOURCE = readFileSync(join(__dirname, 'updater.ts'), 'utf-8');

describe('updater source contracts', () => {
  it('falls back to GitHub API when electron-updater is missing instead of skipping IPC handlers', () => {
    expect(UPDATER_SOURCE).toContain('falling back to GitHub Releases API');
    expect(UPDATER_SOURCE).toContain('registerGithubReleaseApiHandlers(send, true)');
  });

  it('tracks last release URL and opens it from helper (macOS download path)', () => {
    expect(UPDATER_SOURCE).toContain('lastAppReleaseUrl');
    expect(UPDATER_SOURCE).toContain('openAppReleasePage');
  });
});
