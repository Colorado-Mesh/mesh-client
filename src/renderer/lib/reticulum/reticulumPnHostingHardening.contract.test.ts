import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../../../..');
const LIVE = join(REPO_ROOT, 'reticulum-sidecar/src/stack/live.rs');
const STACK_MOD = join(REPO_ROOT, 'reticulum-sidecar/src/stack/mod.rs');
const PN_APPLY = join(REPO_ROOT, 'reticulum-sidecar/src/stack/pn_hosting_apply.rs');
const CI_YAML = join(REPO_ROOT, '.github/workflows/ci.yaml');
const RRC_SESSION = join(REPO_ROOT, 'reticulum-sidecar/src/stack/rrc_session.rs');

describe('reticulum PN hosting / propagation hardening contracts', () => {
  it('probe_propagation_offer claims sync target before start_sync and releases on failure', () => {
    const src = readFileSync(LIVE, 'utf8');
    const probeIdx = src.indexOf('pub async fn probe_propagation_offer');
    expect(probeIdx).toBeGreaterThanOrEqual(0);
    const nextFn = src.indexOf('\n    pub async fn ', probeIdx + 1);
    const body = src.slice(probeIdx, nextFn > 0 ? nextFn : undefined);
    expect(body).toMatch(/set_propagation_sync_target\(Some\(hash\)\)/);
    expect(body).toMatch(
      /if !self\.propagation\.start_sync[\s\S]*?set_propagation_sync_target\(None\)/,
    );
    expect(body).toMatch(/cancel_propagation_sync\(\)\.await/);
  });

  it('set_pn_hosting_policy rolls back in-memory policy when save fails', () => {
    const src = readFileSync(STACK_MOD, 'utf8');
    const idx = src.indexOf('pub async fn set_pn_hosting_policy');
    expect(idx).toBeGreaterThanOrEqual(0);
    const nextFn = src.indexOf('\n    pub async fn ', idx + 1);
    const body = src.slice(idx, nextFn > 0 ? nextFn : undefined);
    expect(body).toMatch(/let snapshot = inner\.pn_hosting_policy\.clone\(\)/);
    expect(body).toMatch(/inner\.pn_hosting_policy = snapshot/);
  });

  it('pn_hosting_apply marks static peers and prunes stale static-only entries', () => {
    const src = readFileSync(PN_APPLY, 'utf8');
    expect(src).toMatch(/entry\.is_static = true/);
    expect(src).toMatch(/!peer\.is_static \|\| desired_static\.contains/);
  });

  it('rrc reconnect and pending_rejoins share handle_rejoin_failure cleanup', () => {
    const src = readFileSync(RRC_SESSION, 'utf8');
    expect(src).toMatch(/async fn handle_rejoin_failure\s*\(/);
    expect(src).toMatch(/g\.desired_rooms\.remove\(&key\)/);
    expect(src).toMatch(/"rrc\.room\.parted"/);
    const reconnectIdx = src.indexOf('// Re-join desired rooms after welcome');
    const pendingIdx = src.indexOf('pending_rejoins');
    expect(reconnectIdx).toBeGreaterThanOrEqual(0);
    expect(pendingIdx).toBeGreaterThanOrEqual(0);
    expect(src.slice(reconnectIdx).match(/handle_rejoin_failure/g)?.length).toBeGreaterThanOrEqual(
      1,
    );
    expect(src.match(/handle_rejoin_failure\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('ci.yaml pnpm audit is blocking (no || echo fallback)', () => {
    const yaml = readFileSync(CI_YAML, 'utf8');
    expect(yaml).toMatch(/pnpm audit --audit-level=high\s*$/m);
    expect(yaml).not.toMatch(/pnpm audit[\s\S]{0,120}\|\|\s*echo/);
  });
});
