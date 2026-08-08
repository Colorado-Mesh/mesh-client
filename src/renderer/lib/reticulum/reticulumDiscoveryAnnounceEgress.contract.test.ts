import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../../../..');
const SIDECAR_LIVE = join(REPO_ROOT, 'reticulum-sidecar/src/stack/live.rs');
const RNS_RETICULUM = join(REPO_ROOT, '.rsstack/rsReticulum/crates/rns-runtime/src/reticulum.rs');
const DISCOVERY_PATCH = join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsReticulum-discovery-announce-egress.patch',
);
const APPLY_SCRIPT = join(REPO_ROOT, 'scripts/apply-rsReticulum-discovery-announce-egress.sh');

describe('reticulum discovery announce egress contracts', () => {
  it('sidecar enables on-network discovery stamper', () => {
    const source = readFileSync(SIDECAR_LIVE, 'utf8');
    expect(source).toMatch(/enable_on_network_discovery\s*\(/);
  });

  it('mesh-client ships discovery announce egress overlay wiring', () => {
    expect(existsSync(DISCOVERY_PATCH)).toBe(true);
    expect(existsSync(APPLY_SCRIPT)).toBe(true);
    const patch = readFileSync(DISCOVERY_PATCH, 'utf8');
    expect(patch).toContain('fn take_online_discovery_interfaces');
    expect(patch).toContain('fn discovery_local_destination_registration');
    expect(patch).toContain('DISCOVERY_ASPECT_FILTER');
    const apply = readFileSync(APPLY_SCRIPT, 'utf8');
    expect(apply).toContain('rsReticulum-discovery-announce-egress.patch');
  });

  it.skipIf(!existsSync(RNS_RETICULUM))(
    'sibling reticulum.rs registers discovery dest and defers until online',
    () => {
      const source = readFileSync(RNS_RETICULUM, 'utf8');
      const hasHelpers =
        source.includes('fn take_online_discovery_interfaces') &&
        source.includes('fn discovery_local_destination_registration');
      const hasInlineFix =
        source.includes('discovery destination registered as local for announce egress') &&
        source.includes('discovery interface online — starting announces');
      expect(hasHelpers || hasInlineFix).toBe(true);
      expect(source).toMatch(/RegisterDestination[\s\S]*DISCOVERY_ASPECT_FILTER/);
      expect(source).toMatch(
        /online[\s\S]*Announcer::register|pending\.retain|take_online_discovery/,
      );
    },
  );
});
