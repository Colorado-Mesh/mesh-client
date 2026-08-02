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
    const manualOnly = src.indexOf('Contacts are manual-only', callbackStart);
    expect(manualOnly).toBeGreaterThan(callbackStart);
    // Close of the delivery callback closure (not spawn_lxmf_inbound_receiver order).
    const callbackEnd = src.indexOf('});', manualOnly);
    expect(callbackEnd).toBeGreaterThan(manualOnly);
    const callbackBody = src.slice(callbackStart, callbackEnd);
    expect(callbackBody).toContain('Contacts are manual-only');
    expect(callbackBody).not.toContain('upsert_contact_with_name_cache');
    expect(callbackBody).not.toMatch(/\bupsert_contact\s*\(/);
  });
});
