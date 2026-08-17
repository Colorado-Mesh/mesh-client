/**
 * Source contract: unattached locally-originated Link packets fail closed
 * (ratspeak/rsReticulum#22 / 921eac4). mesh-client no longer overlays
 * pathless-Link RF exclusion.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../../../..');
const OUTBOUND = join(REPO_ROOT, '.rsstack/rsReticulum/crates/rns-transport/src/actor/outbound.rs');

describe('reticulum unattached Link fail-closed contracts', () => {
  it.skipIf(!existsSync(OUTBOUND))(
    'sibling outbound.rs Link arm drops unattached packets without broadcast',
    () => {
      const source = readFileSync(OUTBOUND, 'utf8');
      const armStart = source.indexOf('rns_wire::flags::DestinationType::Link =>');
      expect(armStart).toBeGreaterThanOrEqual(0);
      const after = source.slice(armStart);
      const armEnd = after.indexOf('\n        }');
      const arm = after.slice(0, armEnd > 0 ? armEnd : 1200);
      expect(arm).toContain('dropping unattached locally-originated Link packet');
      expect(arm).not.toContain('broadcast_on_interfaces');
    },
  );
});
