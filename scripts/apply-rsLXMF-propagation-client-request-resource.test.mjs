import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const APPLY_SCRIPT = path.join(SCRIPT_DIR, 'apply-rsLXMF-propagation-client-request-resource.sh');
const PATCH_FILE = path.join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsLXMF-propagation-client-request-resource.patch',
);
const APPLY_LIST = path.join(SCRIPT_DIR, 'lib/ratspeak-overlay-apply-list.sh');

describe('apply-rsLXMF-propagation-client-request-resource', () => {
  it('patch sends /get bodies past the Link MDU as a request Resource', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toContain('fn start_outbound_request_resource');
    expect(patch).toContain('packed.len() > link.mdu');
    expect(patch).toContain('flags.is_request = true');
    expect(patch).toContain('mark_request_resource_sent');
    expect(patch).toContain('oversized_purge_request_is_sent_as_request_resource');
  });

  it('apply script checks for overlay marker', () => {
    const script = readFileSync(APPLY_SCRIPT, 'utf8');
    expect(script).toContain('start_outbound_request_resource');
    expect(script).toContain('rsLXMF-propagation-client-request-resource.patch');
  });

  it('applies after the LRPROOF diagnostics overlay it is diffed against', () => {
    const list = readFileSync(APPLY_LIST, 'utf8');
    const lrproof = list.indexOf('apply-rsLXMF-propagation-client-lrproof-diagnostics.sh');
    const requestResource = list.indexOf('apply-rsLXMF-propagation-client-request-resource.sh');
    expect(lrproof).toBeGreaterThan(-1);
    expect(requestResource).toBeGreaterThan(lrproof);
  });
});
