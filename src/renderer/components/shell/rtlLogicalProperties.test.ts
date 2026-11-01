import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * RTL pilot guard: shell chrome and the new inbox use Tailwind logical utilities so they mirror
 * under `<html dir="rtl">`. Add files here only after converting them.
 */
const LOGICAL_FILES = [
  'components/shell/AppRail.tsx',
  'components/shell/BottomNav.tsx',
  'components/shell/SectionHeader.tsx',
  'components/shell/PanelLauncher.tsx',
  'components/LanguageSelector.tsx',
  'components/UnifiedInboxDialog.tsx',
  'components/GlobalMessageSearchDialog.tsx',
];

// Physical-direction utilities with a logical equivalent, matched per whitespace/quote token.
const PHYSICAL_TOKENS: readonly RegExp[] = [
  /^-?(?:ml|mr|pl|pr|left|right)-/,
  /^text-(?:left|right)$/,
  /^border-[lr](?:-|$)/,
  /^rounded-[lr](?:-|$)/,
  /^float-(?:left|right)$/,
];

function hasPhysicalToken(line: string): boolean {
  return line.split(/[\s"'`{}]+/).some((token) => PHYSICAL_TOKENS.some((re) => re.test(token)));
}

describe('RTL pilot: logical properties in shell files', () => {
  it.each(LOGICAL_FILES)('%s has no physical left/right utilities', (rel) => {
    const src = readFileSync(path.resolve(import.meta.dirname, '../..', rel), 'utf8');
    const offenders = src
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => hasPhysicalToken(line))
      .map(({ line, n }) => `${rel}:${n}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
