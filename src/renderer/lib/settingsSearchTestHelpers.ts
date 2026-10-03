import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const REPO_ROOT = join(import.meta.dirname, '../../..');
const COMPONENTS_DIR = join(REPO_ROOT, 'src/renderer/components');

const ANCHOR_LITERAL_RE = /(?:data-setting-anchor|anchorId)\s*=\s*(["'])([^"']+)\1/g;
/** Same shape as the i18n scanner: static string-literal keys passed to `t` / `i18n.t`. */
const T_KEY_RE = /\b(?:t|i18n\.t)\(\s*['"]([^'"]+)['"]\s*[),]/g;

export interface ComponentSource {
  /** Repo-relative path with forward slashes. */
  path: string;
  source: string;
}

function walkTsx(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTsx(full, out);
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) out.push(full);
  }
}

export function readComponentSources(): ComponentSource[] {
  const files: string[] = [];
  walkTsx(COMPONENTS_DIR, files);
  return files.map((full) => ({
    path: relative(REPO_ROOT, full).split('\\').join('/'),
    source: readFileSync(full, 'utf8'),
  }));
}

export function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

/** Every literal anchor id in a source file, in order (duplicates kept). */
export function collectAnchorIds(source: string): string[] {
  return Array.from(source.matchAll(ANCHOR_LITERAL_RE), (m) => m[2]);
}

/** Static `t()` keys in a source file, skipping lines marked `// i18n-ok`. */
export function collectTranslationKeys(source: string): Set<string> {
  const keys = new Set<string>();
  for (const match of source.matchAll(T_KEY_RE)) {
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    const lineEnd = source.indexOf('\n', match.index);
    const line = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (!line.includes('// i18n-ok')) keys.add(match[1]);
  }
  return keys;
}
