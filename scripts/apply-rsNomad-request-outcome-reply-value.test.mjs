import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const APPLY_SCRIPT = path.join(SCRIPT_DIR, 'apply-rsNomad-request-outcome-reply-value.sh');
const PATCH_FILE = path.join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsNomad-request-outcome-reply-value.patch',
);

describe('apply-rsNomad-request-outcome-reply-value', () => {
  it('patch migrates RequestOutcome::Reply to ReplyValue / Cursor ReplyFile', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toContain('RequestOutcome::ReplyValue');
    expect(patch).toContain('Cursor::new');
  });

  it('apply script checks for overlay marker', () => {
    const script = readFileSync(APPLY_SCRIPT, 'utf8');
    expect(script).toContain('RequestOutcome::ReplyValue');
    expect(script).toContain('rsNomad-request-outcome-reply-value.patch');
  });
});
