import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const updateScript = readFileSync(new URL('./update.sh', import.meta.url), 'utf8');

describe('update.sh Reticulum stack functionality check', () => {
  it('prepares and requires every rs path dependency before the full-feature build', () => {
    const rebuildFunction = updateScript.match(
      /rebuild_reticulum_sidecar\(\) \{([\s\S]*?)^\}/m,
    )?.[1];

    expect(rebuildFunction).toBeDefined();
    expect(rebuildFunction).toContain('bash scripts/clone-ratspeak-stack.sh');
    expect(rebuildFunction).toContain('../rsReticulum/crates/rns-runtime/Cargo.toml');
    expect(rebuildFunction).toContain('../rsLXMF/crates/lxmf-core/Cargo.toml');
    expect(rebuildFunction).toContain('../rsNomad/crates/nomad-core/Cargo.toml');
    expect(rebuildFunction).toContain('cargo build --features rns-stack,rns-ble,rns-rnode-tcp');
    expect(rebuildFunction).not.toContain('cargo build)');
  });
});
