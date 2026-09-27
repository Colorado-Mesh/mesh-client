import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';

import { SHELL_COMPACT_QUERY } from './bottomNav';
import { DEFAULT_THEME_COLORS, THEME_CSS_VARS, type ThemeColorKey } from './themeColors';
import { DEFAULT_THEME_SURFACE_ID, INK_STEPS, THEME_ACCENTS, themeSurface } from './themePresets';
import { contrastRatio } from './wcagContrast';

const CSS = readFileSync(join(import.meta.dirname, '..', 'styles.css'), 'utf8');

function themeTokens(): Map<string, string> {
  const block = /@theme \{([\s\S]*?)\n\}/.exec(CSS);
  if (!block) throw new Error('styles.css has no @theme block');
  const tokens = new Map<string, string>();
  for (const match of block[1].matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

const TOKENS = themeTokens();

function token(name: string): string {
  const value = TOKENS.get(name);
  if (value === undefined) throw new Error(`styles.css @theme is missing ${name}`);
  return value;
}

/** `#rrggbb`, or the colour part of `rgb(r g b / a)` as `#rrggbb`. */
function opaqueHex(value: string): string {
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ [\d.]+\)$/.exec(value);
  if (rgb) {
    return `#${rgb
      .slice(1, 4)
      .map((channel) => Number(channel).toString(16).padStart(2, '0'))
      .join('')}`;
  }
  return value.toLowerCase();
}

const INK_800 = token('--color-ink-800');

describe('style guide tokens (styles.css)', () => {
  it('every theme default in themeColors.ts matches styles.css, which it overrides at boot', () => {
    for (const key of Object.keys(THEME_CSS_VARS) as ThemeColorKey[]) {
      const value = token(THEME_CSS_VARS[key]);
      const alias = /^var\((--[\w-]+)\)$/.exec(value);
      const expected = alias ? opaqueHex(token(alias[1])) : opaqueHex(value);
      expect(DEFAULT_THEME_COLORS[key].toLowerCase(), key).toBe(expected);
    }
  });

  it('defines the five-step scale for every protocol', () => {
    for (const protocol of REGISTERED_MESH_PROTOCOLS) {
      for (const step of [100, 300, 500, 700, 900]) {
        expect(token(`--color-${protocol}-${step}`)).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('protocol 700 steps keep 4.5:1 under white and 500 steps keep 4.5:1 on ink-800', () => {
    for (const protocol of REGISTERED_MESH_PROTOCOLS) {
      expect(contrastRatio('#ffffff', token(`--color-${protocol}-700`))).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(token(`--color-${protocol}-500`), INK_800)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the default accent is the Meshtastic scale', () => {
    expect(DEFAULT_THEME_COLORS.brandGreen).toBe(token('--color-meshtastic-500'));
    expect(DEFAULT_THEME_COLORS.readableGreen).toBe(token('--color-meshtastic-700'));
  });

  it('each protocol accent is its own scale: 500 for the accent, 700 for fills', () => {
    for (const protocol of REGISTERED_MESH_PROTOCOLS) {
      const accent = THEME_ACCENTS.find((a) => a.id === protocol);
      expect(accent?.base).toBe(token(`--color-${protocol}-500`));
      expect(accent?.fill).toBe(token(`--color-${protocol}-700`));
    }
  });

  it('the default surface is the ink scale styles.css ships, step for step', () => {
    const midnight = themeSurface(DEFAULT_THEME_SURFACE_ID);
    for (const step of INK_STEPS) {
      expect(midnight.scale[step], `ink-${step}`).toBe(token(`--color-ink-${step}`));
    }
  });

  it('status colors reach 3:1 against raised surfaces (dots and icons)', () => {
    for (const status of ['success', 'warning', 'error', 'info']) {
      expect(contrastRatio(token(`--color-status-${status}`), INK_800)).toBeGreaterThanOrEqual(3);
    }
  });

  it('the ink neutrals carry the Midnight Serenity swatches and keep muted text at 4.5:1', () => {
    for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
      expect(token(`--color-ink-${step}`)).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(token('--color-ink-950')).toBe('#11151c'); // Ink Black
    expect(token('--color-ink-800')).toBe('#212d40'); // Deep Space Blue
    expect(token('--color-ink-700')).toBe('#364156'); // Charcoal Blue
    expect(DEFAULT_THEME_COLORS.muted).toBe(token('--color-ink-400'));
    for (const surface of [950, 900, 800]) {
      expect(
        contrastRatio(DEFAULT_THEME_COLORS.muted, token(`--color-ink-${surface}`)),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('elevation is its own level tokens, not overrides of the stock Tailwind shadows', () => {
    for (const level of [1, 2, 3, 4]) {
      expect(token(`--shadow-level-${level}`)).toContain('rgb(0 0 0');
    }
    for (const stock of ['xs', 'sm', 'md', 'lg', 'xl', '2xl']) {
      expect(TOKENS.has(`--shadow-${stock}`)).toBe(false);
    }
  });

  it('keeps toasts above the status bar and the phone-width bottom nav', () => {
    const source = (file: string) =>
      readFileSync(join(import.meta.dirname, '..', 'components', file), 'utf8');
    // The offsets below are these two bars' heights; changing a bar means changing the offset.
    expect(source('shell/StatusBar.tsx')).toMatch(/<footer className="[^"]*\bh-7\b/);
    expect(source('shell/BottomNav.tsx')).toMatch(/\bmin-h-14\b/);
    expect(CSS).toContain('--shell-bottom-chrome: 1.75rem;');
    const compact = CSS.slice(CSS.indexOf(`@media ${SHELL_COMPACT_QUERY} {`));
    expect(compact).toContain(
      '--shell-bottom-chrome: calc(1.75rem + 3.5rem + 1px + env(safe-area-inset-bottom));',
    );
    expect(source('Toast.tsx')).toContain('bottom-[calc(var(--shell-bottom-chrome,0px)+0.75rem)]');
  });

  it('hover: never lights up a disabled control', () => {
    // One override covers every hover: utility, so no control needs a disabled:hover: undo class.
    const variant = CSS.slice(CSS.indexOf('@custom-variant hover {'));
    expect(variant).toContain("&:hover:not(:disabled, [aria-disabled='true'])");
    expect(variant.indexOf('@media (hover: hover)')).toBeGreaterThan(0);
  });
});
