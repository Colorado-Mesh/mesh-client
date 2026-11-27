/**
 * Save dialog → export folder. The UI hands out `/exports/<id>/<name>` per save; main then writes
 * there as it would into a folder the user picked on desktop, without creating it. Chat export
 * failed on Android with ENOENT until the worker created the folder.
 */
import { describe, expect, it } from 'vitest';

import { prepareExportTarget } from './electron';
import fs from './node/fs';

describe('save dialog export target', () => {
  it('a write into an export folder nobody created fails with ENOENT (the Android bug)', () => {
    expect(() => {
      fs.writeFileSync('/exports/not-prepared/mesh-chat.txt', 'x');
    }).toThrow(/ENOENT/);
  });

  it('creates the per-save folder so main can write the export', () => {
    const filePath = '/exports/save-1/mesh-chat-2026-11-27.txt';
    expect(fs.existsSync('/exports/save-1')).toBe(false);
    const result = { canceled: false, filePath };
    expect(prepareExportTarget(result)).toBe(result);
    expect(fs.statSync('/exports/save-1').isDirectory()).toBe(true);
  });

  it('leaves cancelled saves and paths outside /exports alone', () => {
    prepareExportTarget({ canceled: true, filePath: '/exports/save-2/x.txt' });
    expect(fs.existsSync('/exports/save-2')).toBe(false);
    prepareExportTarget({ canceled: false, filePath: '/elsewhere/save-3/x.txt' });
    expect(fs.existsSync('/elsewhere/save-3')).toBe(false);
    prepareExportTarget({ canceled: false });
  });
});
