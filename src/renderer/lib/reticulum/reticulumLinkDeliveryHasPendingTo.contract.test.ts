import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../../../..');
const OUTBOUND = join(REPO_ROOT, 'reticulum-sidecar/src/stack/lxmf_outbound.rs');
const LXMF_LINK = join(REPO_ROOT, '../rsLXMF/crates/lxmf-core/src/link_delivery.rs');
const HAS_PENDING_PATCH = join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsLXMF-link-delivery-has-pending-to.patch',
);
const APPLY_SCRIPT = join(REPO_ROOT, 'scripts/apply-rsLXMF-link-delivery-has-pending-to.sh');
const CLONE_SCRIPT = join(REPO_ROOT, 'scripts/clone-ratspeak-stack.sh');
const ENSURE_SCRIPT = join(REPO_ROOT, 'scripts/ensure-rsReticulum-patches.sh');

describe('reticulum LinkDeliveryManager has_pending_to contracts', () => {
  it('sidecar queries has_pending_to for PN link serialization', () => {
    const source = readFileSync(OUTBOUND, 'utf8');
    expect(source).toMatch(/\.has_pending_to\s*\(/);
  });

  it('mesh-client ships has_pending_to overlay wiring', () => {
    expect(existsSync(HAS_PENDING_PATCH)).toBe(true);
    expect(existsSync(APPLY_SCRIPT)).toBe(true);
    const patch = readFileSync(HAS_PENDING_PATCH, 'utf8');
    expect(patch).toContain('fn has_pending_to');
    const apply = readFileSync(APPLY_SCRIPT, 'utf8');
    expect(apply).toContain('rsLXMF-link-delivery-has-pending-to.patch');
    const clone = readFileSync(CLONE_SCRIPT, 'utf8');
    expect(clone).toContain('apply-rsLXMF-link-delivery-has-pending-to.sh');
    const ensure = readFileSync(ENSURE_SCRIPT, 'utf8');
    expect(ensure).toContain('apply-rsLXMF-link-delivery-has-pending-to.sh');
  });

  it.skipIf(!existsSync(LXMF_LINK))('sibling link_delivery.rs exposes has_pending_to', () => {
    const source = readFileSync(LXMF_LINK, 'utf8');
    expect(source).toMatch(/fn has_pending_to\s*\(/);
  });
});
