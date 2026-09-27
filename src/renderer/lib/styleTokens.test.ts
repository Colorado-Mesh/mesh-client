import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';

import { DEFAULT_THEME_COLORS, THEME_CSS_VARS, type ThemeColorKey } from './themeColors';
import { THEME_PRESETS } from './themePresets';
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

const ZINC_800 = '#27272a';

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

  it('protocol 700 steps keep 4.5:1 under white and 500 steps keep 4.5:1 on zinc-800', () => {
    for (const protocol of REGISTERED_MESH_PROTOCOLS) {
      expect(contrastRatio('#ffffff', token(`--color-${protocol}-700`))).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(token(`--color-${protocol}-500`), ZINC_800)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the default accent is the Meshtastic scale', () => {
    expect(DEFAULT_THEME_COLORS.brandGreen).toBe(token('--color-meshtastic-500'));
    expect(DEFAULT_THEME_COLORS.readableGreen).toBe(token('--color-meshtastic-700'));
  });

  it('the MeshCore and Reticulum presets use their own 500 accent and 700 fill', () => {
    for (const protocol of ['meshcore', 'reticulum'] as const) {
      const preset = THEME_PRESETS.find((p) => p.id === protocol);
      expect(preset?.colors.brandGreen).toBe(token(`--color-${protocol}-500`));
      expect(preset?.colors.readableGreen).toBe(token(`--color-${protocol}-700`));
    }
  });

  it('status colors reach 3:1 against raised surfaces (dots and icons)', () => {
    for (const status of ['success', 'warning', 'error', 'info']) {
      expect(contrastRatio(token(`--color-status-${status}`), ZINC_800)).toBeGreaterThanOrEqual(3);
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
});
