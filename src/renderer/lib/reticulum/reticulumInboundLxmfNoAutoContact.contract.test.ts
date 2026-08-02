import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../../../..');
const LIVE_RS = join(REPO_ROOT, 'reticulum-sidecar/src/stack/live.rs');

describe('reticulum inbound LXMF contact policy', () => {
  it('delivery callback does not upsert contacts', () => {
    const src = readFileSync(LIVE_RS, 'utf8');
    const callbackStart = src.indexOf('router.register_delivery_callback');
    expect(callbackStart).toBeGreaterThanOrEqual(0);
    const callbackEnd = src.indexOf('spawn_lxmf_inbound_receiver', callbackStart);
    expect(callbackEnd).toBeGreaterThan(callbackStart);
    const callbackBody = src.slice(callbackStart, callbackEnd);
    expect(callbackBody).toContain('Contacts are manual-only');
    expect(callbackBody).not.toContain('upsert_contact_with_name_cache');
    expect(callbackBody).not.toMatch(/\bupsert_contact\s*\(/);
  });
});
