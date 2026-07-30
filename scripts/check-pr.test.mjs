import { describe, expect, it } from 'vitest';

import { branchTouchesSidecar } from './check-pr.mjs';

describe('check-pr branchTouchesSidecar', () => {
  it('detects reticulum-sidecar and related scripts', () => {
    expect(branchTouchesSidecar(['src/renderer/App.tsx'])).toBe(false);
    expect(branchTouchesSidecar(['reticulum-sidecar/src/main.rs'])).toBe(true);
    expect(branchTouchesSidecar(['scripts/check-reticulum-sidecar.sh'])).toBe(true);
    expect(branchTouchesSidecar(['docs/reticulum.md', 'scripts/clone-ratspeak-stack.sh'])).toBe(
      true,
    );
  });
});
