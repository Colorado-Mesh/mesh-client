// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/ci-setup-linux-arm64-apt.sh';

describe('ci-setup-linux-arm64-apt.sh', () => {
  it('allows scoped apt downgrades after enabling arm64 multiarch', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    expect(script).toContain('99-mesh-client-ci-arm64-cross');
    expect(script).toMatch(/Allow-Downgrades/);
    expect(script).toMatch(/Packages were downgraded|downgrades/i);
  });
});
