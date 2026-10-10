import { describe, expect, it } from 'vitest';

import { branchTouchesSidecar } from './check-pr.mjs';

describe('check-pr branchTouchesSidecar', () => {
  it('detects ble-sidecar and related scripts', () => {
    expect(branchTouchesSidecar(['src/renderer/App.tsx'])).toBe(false);
    expect(branchTouchesSidecar(['ble-sidecar/src/main.rs'])).toBe(true);
    expect(branchTouchesSidecar(['scripts/check-ble-sidecar.sh'])).toBe(true);
    expect(branchTouchesSidecar(['docs/index.md'])).toBe(false);
  });
});
