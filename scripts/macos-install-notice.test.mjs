// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MACOS_DMG_NOTICE_NAME,
  MACOS_INSTALL_NOTICE_SOURCE,
  MACOS_RELEASE_ASSET_NAME,
  formatMacosInstallReleaseMarkdown,
  mergeMacosInstallNoteIntoReleaseBody,
  readMacosInstallNoticeText,
  stageMacosInstallNoticeReleaseAsset,
} from './macos-install-notice.mjs';

describe('macos-install-notice', () => {
  it('canonical notice warns about 7-Zip and links Keka', () => {
    const text = readMacosInstallNoticeText();
    expect(text).toContain('7-Zip');
    expect(text).toContain('https://www.keka.io/en/');
    expect(text).toContain('Squirrel.framework');
    expect(text).toContain('macOS 13 Ventura');
    expect(readFileSync(MACOS_INSTALL_NOTICE_SOURCE, 'utf8')).toBe(text);
  });

  it('release markdown mentions DMG, Keka, and 7-Zip', () => {
    const md = formatMacosInstallReleaseMarkdown();
    expect(md).toContain('### macOS install');
    expect(md).toContain('macOS 13 Ventura');
    expect(md).toContain('.dmg');
    expect(md).toContain('https://www.keka.io/en/');
    expect(md).toContain('7-Zip');
    expect(md).toContain('Squirrel.framework');
  });

  it('mergeMacosInstallNoteIntoReleaseBody replaces prior macOS install block', () => {
    const first = mergeMacosInstallNoteIntoReleaseBody('', '### macOS install\n\nold');
    const second = mergeMacosInstallNoteIntoReleaseBody(first, '### macOS install\n\nnew');
    expect(second).toContain('new');
    expect(second).not.toContain('old');
    expect((second.match(/<!-- mesh-client-macos-install -->/g) ?? []).length).toBe(2);
  });

  it('stageMacosInstallNoticeReleaseAsset writes companion asset name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'macos-install-notice-'));
    try {
      const dest = stageMacosInstallNoticeReleaseAsset(dir);
      expect(dest.endsWith(MACOS_RELEASE_ASSET_NAME)).toBe(true);
      expect(readFileSync(dest, 'utf8')).toContain('7-Zip');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exports stable DMG notice filename', () => {
    expect(MACOS_DMG_NOTICE_NAME).toBe('IMPORTANT-Read-Me.txt');
  });
});
