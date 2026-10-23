import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

it('keeps a root Package.swift so CodeQL Swift autobuild can find the AI helper', () => {
  const manifest = path.join(root, 'Package.swift');
  const source = path.join(root, 'native/ai/apple/main.swift');
  expect(fs.existsSync(manifest), 'Package.swift must live at the repo root').toBe(true);
  expect(fs.existsSync(source), 'native/ai/apple/main.swift must exist').toBe(true);
  const text = fs.readFileSync(manifest, 'utf8');
  expect(text).toContain('path: "native/ai/apple"');
  expect(text).toContain('sources: ["main.swift"]');
  expect(text).toMatch(/platforms:\s*\[\s*\.macOS\("26\.0"\)\s*\]/);
});
