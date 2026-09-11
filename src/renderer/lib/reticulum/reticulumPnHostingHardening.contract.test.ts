import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../../../..');
const LIVE = join(REPO_ROOT, 'reticulum-sidecar/src/stack/live.rs');
const STACK_MOD = join(REPO_ROOT, 'reticulum-sidecar/src/stack/mod.rs');
const PN_APPLY = join(REPO_ROOT, 'reticulum-sidecar/src/stack/pn_hosting_apply.rs');
const CI_YAML = join(REPO_ROOT, '.github/workflows/ci.yaml');
const RRC_SESSION = join(REPO_ROOT, 'reticulum-sidecar/src/stack/rrc_session.rs');

/** Slice from `fnName` through the next same-indent `pub async fn` (or EOF). */
function extractAsyncFnBody(src: string, fnName: string): string {
  const idx = src.indexOf(`pub async fn ${fnName}`);
  expect(idx).toBeGreaterThanOrEqual(0);
  const nextFn = src.indexOf('\n    pub async fn ', idx + 1);
  return src.slice(idx, nextFn > 0 ? nextFn : undefined);
}

describe('reticulum PN hosting / propagation hardening contracts', () => {
  it('probe_propagation_offer claims sync target before start_sync and releases on failure', () => {
    const body = extractAsyncFnBody(readFileSync(LIVE, 'utf8'), 'probe_propagation_offer');

    const claimIdx = body.search(/set_propagation_sync_target\(Some\(hash\)\)/);
    const startIdx = body.search(/self\.propagation\.start_sync\s*\(/);
    expect(claimIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(claimIdx).toBeLessThan(startIdx);

    // None rollback must live in the start_sync failure arm, not elsewhere in the fn.
    expect(body).toMatch(
      /if !self\.propagation\.start_sync\([\s\S]*?\) \{\s*[\s\S]*?set_propagation_sync_target\(None\)[\s\S]*?return Err\("PROPAGATION_OFFER_PROBE_FAILED"/,
    );

    // Polling exits must cancel (clears the claim) rather than only clearing on start failure.
    const loopIdx = body.indexOf('loop {');
    expect(loopIdx).toBeGreaterThan(startIdx);
    const loopBody = body.slice(loopIdx);
    expect(loopBody).toMatch(/cancel_propagation_sync\(\)\.await/);
    expect(loopBody.match(/cancel_propagation_sync\(\)\.await/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('set_pn_hosting_policy rolls back in-memory policy when save fails', () => {
    const body = extractAsyncFnBody(readFileSync(STACK_MOD, 'utf8'), 'set_pn_hosting_policy');
    expect(body).toMatch(/let snapshot = inner\.pn_hosting_policy\.clone\(\)/);
    // Restore must be inside the save-error branch, before returning Err.
    expect(body).toMatch(
      /if let Err\(e\) = inner\.save\([\s\S]*?\{\s*[\s\S]*?inner\.pn_hosting_policy = snapshot;[\s\S]*?return Err\(e\);/,
    );
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
    expect(reconnectIdx).toBeGreaterThanOrEqual(0);
    const reconnectSlice = src.slice(reconnectIdx, reconnectIdx + 1200);
    expect(reconnectSlice).toMatch(
      /for \(room, key\) in rooms \{[\s\S]*?handle_rejoin_failure\s*\(/,
    );

    // Scope to the pending_rejoins take + loop, not a later call site.
    const pendingTakeIdx = src.indexOf('std::mem::take(&mut g.pending_rejoins)');
    expect(pendingTakeIdx).toBeGreaterThanOrEqual(0);
    const pendingSlice = src.slice(pendingTakeIdx, pendingTakeIdx + 800);
    expect(pendingSlice).toMatch(
      /for \(room, key\) in rejoins \{[\s\S]*?handle_rejoin_failure\s*\(/,
    );
  });

  it('ci.yaml pnpm audit is blocking (no || echo fallback)', () => {
    const yaml = readFileSync(CI_YAML, 'utf8');
    expect(yaml).toMatch(/pnpm audit --audit-level=high\s*$/m);
    expect(yaml).not.toMatch(/pnpm audit[\s\S]{0,120}\|\|\s*echo/);
  });
});
