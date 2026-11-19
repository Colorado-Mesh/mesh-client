import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'loadNodeUpsert.ts'),
  'utf8',
);

describe('loadNodeUpsert', () => {
  it('loads the production sibling chunk and exposes a test cache reset', () => {
    expect(SOURCE).toContain("path.join(__dirname, 'node-upsert.js')");
    expect(SOURCE).toContain('toNodeUpsertParamsViaSibling');
    expect(SOURCE).toContain('saveNodeRowViaSibling');
    expect(SOURCE).toContain('saveNodesBatchViaSibling');
    expect(SOURCE).toContain('resetNodeUpsertCacheForTests');
  });
});
