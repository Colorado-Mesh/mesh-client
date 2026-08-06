// @vitest-environment node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DYNAMIC_T_PREFIXES,
  collectUsedI18nKeys,
  pruneNestedLocale,
} from '../scripts/i18n-unused-keys.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EN_FILE = join(__dirname, '../src/renderer/locales/en/translation.json');

describe('i18n-unused-keys', () => {
  it('finds no unused keys after audit prune', () => {
    const { unused } = collectUsedI18nKeys(join(__dirname, '../src'), EN_FILE);
    expect(unused).toEqual([]);
  });

  it('registers gamesPanel chess promoteTo and delivery dynamic prefixes', () => {
    const prefixes = DYNAMIC_T_PREFIXES.map((e) => e.prefix);
    expect(prefixes).toContain('gamesPanel.chess.promoteTo.');
    expect(prefixes).toContain('gamesPanel.delivery.');

    const { unused, usedDynamic, usedStatic, activeDynamicPrefixes } = collectUsedI18nKeys(
      join(__dirname, '../src'),
      EN_FILE,
    );
    // Template usage in ChessBoard activates the promoteTo prefix.
    expect(activeDynamicPrefixes).toContain('gamesPanel.chess.promoteTo.');
    const promoteKeys = [...usedDynamic].filter((k) => k.startsWith('gamesPanel.chess.promoteTo.'));
    expect(promoteKeys.length).toBeGreaterThan(0);
    // delivery.* is currently referenced via static t(); prefix still keeps leaves covered.
    const deliveryUsed = [...usedStatic, ...usedDynamic].filter((k) =>
      k.startsWith('gamesPanel.delivery.'),
    );
    expect(deliveryUsed.length).toBeGreaterThan(0);
    expect(unused.filter((k) => k.startsWith('gamesPanel.chess.promoteTo.'))).toEqual([]);
    expect(unused.filter((k) => k.startsWith('gamesPanel.delivery.'))).toEqual([]);
  });

  it('pruneNestedLocale removes flat keys from nested objects', () => {
    const tree = {
      chatPanel: { used: 'ok', stale: 'remove me' },
      tabs: { chat: 'Chat' },
    };
    pruneNestedLocale(tree, new Set(['chatPanel.stale']));
    expect(tree).toEqual({ chatPanel: { used: 'ok' }, tabs: { chat: 'Chat' } });
  });
});
