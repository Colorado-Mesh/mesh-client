import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const APPLY_SCRIPT = path.join(SCRIPT_DIR, 'apply-rsLXMF-propagation-client-link-hops.sh');
const PATCH_FILE = path.join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsLXMF-propagation-client-link-hops.patch',
);

describe('apply-rsLXMF-propagation-client-link-hops', () => {
  it('patch scales Link::new_initiator hops and stamps LinkEstablishTimeout', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toContain('LinkEstablishTimeout');
    expect(patch).toContain('link_hops');
    expect(patch).toContain('Link::new_initiator(node_hash, hops)');
    expect(patch).toContain('start_download_with_limit(None, 1)');
  });

  it('apply script checks for overlay marker', () => {
    const script = readFileSync(APPLY_SCRIPT, 'utf8');
    expect(script).toContain('LinkEstablishTimeout');
    expect(script).toContain('rsLXMF-propagation-client-link-hops.patch');
  });
});
