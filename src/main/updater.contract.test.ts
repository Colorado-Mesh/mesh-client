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

  it('emits update:checking for interactive checks and exposes menu entry point', () => {
    expect(UPDATER_SOURCE).toContain("send('update:checking'");
    expect(UPDATER_SOURCE).toContain('notifyOnSettled: true');
    expect(UPDATER_SOURCE).toContain('notifyOnSettled: false');
    expect(UPDATER_SOURCE).toContain('getCheckNowFromMenu');
  });
});
