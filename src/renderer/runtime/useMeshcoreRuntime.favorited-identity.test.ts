// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(__dirname, '../runtime/useMeshcoreRuntime.ts'), 'utf-8');

describe('useMeshcoreRuntime setNodeFavorited identity bucket', () => {
  it('prefers active connection identity over protocol default bucket', () => {
    expect(SOURCE).toMatch(
      /meshcoreIdentityIdRef\.current \?\? getIdentityIdForProtocol\('meshcore'\)/,
    );
  });
});
