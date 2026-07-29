import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../../../..');
const PN_APPLY = join(REPO_ROOT, 'reticulum-sidecar/src/stack/pn_hosting_apply.rs');
const LXMF_NODE = join(REPO_ROOT, '../rsLXMF/crates/lxmf-core/src/propagation_node.rs');
const POLICY_SETTERS_PATCH = join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsLXMF-propagation-node-policy-setters.patch',
);
const APPLY_SCRIPT = join(REPO_ROOT, 'scripts/apply-rsLXMF-propagation-node-policy-setters.sh');
const CLONE_SCRIPT = join(REPO_ROOT, 'scripts/clone-ratspeak-stack.sh');
const ENSURE_SCRIPT = join(REPO_ROOT, 'scripts/ensure-rsReticulum-patches.sh');

describe('reticulum PropagationNode policy setter contracts', () => {
  it('sidecar applies peering/storage/size via PropagationNode setters', () => {
    const source = readFileSync(PN_APPLY, 'utf8');
    expect(source).toMatch(/node\.set_peering_cost\s*\(/);
    expect(source).toMatch(/node\.set_max_storage\s*\(/);
    expect(source).toMatch(/node\.set_max_message_size\s*\(/);
  });

  it('mesh-client ships PropagationNode policy setters overlay wiring', () => {
    expect(existsSync(POLICY_SETTERS_PATCH)).toBe(true);
    expect(existsSync(APPLY_SCRIPT)).toBe(true);
    const patch = readFileSync(POLICY_SETTERS_PATCH, 'utf8');
    expect(patch).toContain('fn set_peering_cost');
    expect(patch).toContain('fn set_max_storage');
    expect(patch).toContain('fn set_max_message_size');
    const apply = readFileSync(APPLY_SCRIPT, 'utf8');
    expect(apply).toContain('rsLXMF-propagation-node-policy-setters.patch');
    const clone = readFileSync(CLONE_SCRIPT, 'utf8');
    expect(clone).toContain('apply-rsLXMF-propagation-node-policy-setters.sh');
    const ensure = readFileSync(ENSURE_SCRIPT, 'utf8');
    expect(ensure).toContain('apply-rsLXMF-propagation-node-policy-setters.sh');
  });

  it.skipIf(!existsSync(LXMF_NODE))(
    'sibling propagation_node.rs exposes live policy setters',
    () => {
      const source = readFileSync(LXMF_NODE, 'utf8');
      expect(source).toMatch(/fn set_peering_cost\s*\(/);
      expect(source).toMatch(/fn set_max_storage\s*\(/);
      expect(source).toMatch(/fn set_max_message_size\s*\(/);
    },
  );
});
