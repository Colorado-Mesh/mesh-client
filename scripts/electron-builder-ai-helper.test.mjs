import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { stageOptionalAiHelper } from './electron-builder-before-pack.mjs';

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-ai-pack-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

it.each(['darwin', 'win32', 'linux'])(
  'clears stale helpers and tolerates a missing optional helper on %s',
  (platform) => {
    const active = path.join(root, 'resources/ai-helper/active');
    fs.mkdirSync(active, { recursive: true });
    fs.writeFileSync(path.join(active, 'stale.exe'), 'old');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => stageOptionalAiHelper(root, platform)).not.toThrow();
    expect(fs.readdirSync(active)).toEqual([]);
    if (platform === 'darwin') expect(warn).toHaveBeenCalledOnce();
  },
);
it('stages Apple AI but excludes staged Windows runtimes from NSIS', () => {
  const staged = path.join(root, 'resources/ai-helper/staged');
  fs.mkdirSync(path.join(staged, 'darwin'), { recursive: true });
  fs.writeFileSync(path.join(staged, 'darwin/mesh-ai'), 'universal');
  fs.mkdirSync(path.join(staged, 'win-x64'), { recursive: true });
  fs.writeFileSync(path.join(staged, 'win-x64/mesh-ai.exe'), 'self-contained');
  stageOptionalAiHelper(root, 'darwin');
  expect(fs.readFileSync(path.join(root, 'resources/ai-helper/active/mesh-ai'), 'utf8')).toBe(
    'universal',
  );
  stageOptionalAiHelper(root, 'win32');
  expect(fs.readdirSync(path.join(root, 'resources/ai-helper/active'))).toEqual([]);
});
