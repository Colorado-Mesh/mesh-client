// @vitest-environment node
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Guard: the incoming-call ring paints above every other fixed overlay in the renderer, so an
 * open dialog or panel can never hide a call. Cross-file, so not a sourcePolicyRules regex.
 */
const RENDERER_DIR = join(__dirname, '../renderer');
const RING_FILE = join(RENDERER_DIR, 'components/reticulum/ReticulumVoiceOverlay.tsx');
const Z_CLASS = /\bz-(?:\[(\d+)\]|(\d+)(?![\w-]))/g;

function ringZIndex(): number {
  const source = readFileSync(RING_FILE, 'utf-8');
  const owner = source.indexOf('data-keyboard-owner=""');
  expect(owner).toBeGreaterThan(-1);
  const classes = [...source.slice(0, owner).matchAll(Z_CLASS)];
  const last = classes.at(-1);
  return Number(last?.[1] ?? last?.[2]);
}

function rendererSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return rendererSources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('incoming call ring stacking', () => {
  it('sits above every other fixed overlay', () => {
    const ring = ringZIndex();
    expect(ring).toBeGreaterThan(0);

    const atOrAbove: string[] = [];
    for (const file of rendererSources(RENDERER_DIR)) {
      if (file === RING_FILE) continue;
      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, index) => {
          if (!/\bfixed\b/.test(line)) return;
          for (const match of line.matchAll(Z_CLASS)) {
            const z = Number(match[1] ?? match[2]);
            if (z >= ring) atOrAbove.push(`${relative(RENDERER_DIR, file)}:${index + 1} z ${z}`);
          }
        });
    }
    expect(atOrAbove).toEqual([]);
  });
});
