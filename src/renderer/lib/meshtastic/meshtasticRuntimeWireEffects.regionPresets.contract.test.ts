/**
 * Regression guard: the firmware region-preset map is identity-scoped, so a disconnect must
 * clear it or a later session on firmware without the map keeps a stale preset restriction.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(__dirname, 'meshtasticRuntimeWireEffects.ts'), 'utf-8');

describe('meshtastic region presets lifecycle contract', () => {
  it('stores regionPresets from FromRadio and clears it on disconnect', () => {
    expect(SOURCE).toContain("variant?.case === 'regionPresets'");
    const disconnectIdx = SOURCE.indexOf('setSecurityConfig(null);');
    expect(disconnectIdx).toBeGreaterThan(-1);
    const body = SOURCE.slice(disconnectIdx, disconnectIdx + 400);
    expect(body).toContain('meshtasticIdentityIdRef.current');
    expect(body).toMatch(
      /setMeshtasticConfigSlice\(\s*meshtasticIdentityIdRef\.current,\s*MESHTASTIC_REGION_PRESETS_SLICE_KEY,\s*undefined,?\s*\)/,
    );
  });
});
