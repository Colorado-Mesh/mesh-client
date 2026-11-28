import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { electronSurface, INVARIANTS, pinnedFiles } from './audit.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-mobile-audit-test-'));
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function fixture(name, text) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
}

describe('mobile audit', () => {
  it('collects Electron exports and member accesses (aliases, default, type-only skipped)', () => {
    const a = fixture(
      'a.ts',
      "import { app, dialog as d, type IpcMainEvent } from 'electron';\n" +
        "import electron from 'electron';\n" +
        'app.getPath("userData"); d.showOpenDialog({}); electron.shell.openExternal("x");\n',
    );
    const b = fixture('b.ts', "import { app } from './notElectron';\napp.newThing();\n");
    expect(electronSurface([a, b])).toEqual([
      'app',
      'app.getPath',
      'dialog',
      'dialog.showOpenDialog',
      'electron.shell',
    ]);
  });

  it('pins every overridden desktop module and the sidecar entry', () => {
    const files = pinnedFiles();
    expect(files).toContain('src/renderer/components/SetLocationCard.tsx');
    expect(files).toContain('src/main/gatt-sidecar-proxy.ts');
    expect(files).toContain('reticulum-sidecar/src/main.rs');
    for (const file of files)
      expect(fs.existsSync(path.join(import.meta.dirname, '../..', file))).toBe(true);
  });

  it('every invariant holds on this tree', () => {
    for (const [file, text] of INVARIANTS) {
      expect(
        fs.readFileSync(path.join(import.meta.dirname, '../..', file), 'utf8'),
        file,
      ).toContain(text);
    }
  });
});
