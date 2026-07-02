// @vitest-environment node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectUsedI18nKeys, pruneNestedLocale } from '../scripts/i18n-unused-keys.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EN_FILE = join(__dirname, '../src/renderer/locales/en/translation.json');

describe('i18n-unused-keys', () => {
  it('finds no unused keys after audit prune', () => {
    const { unused } = collectUsedI18nKeys(join(__dirname, '../src'), EN_FILE);
    expect(unused).toEqual([]);
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
