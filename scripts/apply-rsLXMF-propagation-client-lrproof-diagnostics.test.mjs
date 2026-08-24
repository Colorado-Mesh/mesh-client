import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const APPLY_SCRIPT = path.join(
  SCRIPT_DIR,
  'apply-rsLXMF-propagation-client-lrproof-diagnostics.sh',
);
const PATCH_FILE = path.join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsLXMF-propagation-client-lrproof-diagnostics.patch',
);

describe('apply-rsLXMF-propagation-client-lrproof-diagnostics', () => {
  it('patch adds PropagationClient last_establish_error diagnostics', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toContain('last_establish_error');
    expect(patch).toContain('LrproofIdentityMissing');
    expect(patch).toContain('LrproofInvalid');
    expect(patch).toContain('fn last_establish_error');
  });

  it('apply script checks for overlay marker', () => {
    const script = readFileSync(APPLY_SCRIPT, 'utf8');
    expect(script).toContain('last_establish_error');
    expect(script).toContain('rsLXMF-propagation-client-lrproof-diagnostics.patch');
  });
});
