// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { extractRegistryKeys, isTagCoveredByRegistry } from './check-log-panel-filter.mjs';

describe('check-log-panel-filter registry parser', () => {
  it('extracts LOG_TAG_SCOPE keys including prefix forms', () => {
    const sample = `
export const LOG_TAG_SCOPE = Object.freeze({
  '[Meshtastic MQTT]': { protocol: 'meshtastic', surface: 'app' },
  '[meshcoreRoom': { protocol: 'meshcore', surface: 'app' },
  '[GATT:': { surface: 'device' },
  '[GATT:meshcore]': { protocol: 'meshcore', surface: 'device' },
});
`;
    const keys = extractRegistryKeys(sample);
    expect(keys).toEqual(
      expect.arrayContaining(['[Meshtastic MQTT]', '[meshcoreRoom', '[GATT:', '[GATT:meshcore]']),
    );
    expect(keys.length).toBeGreaterThanOrEqual(4);
  });

  it('accepts tags covered by a registry prefix and rejects unknowns', () => {
    const keys = ['[GATT:meshcore]', '[GATT:', '[meshcoreRoom', '[useMeshcoreRuntime]'].sort(
      (a, b) => b.length - a.length,
    );
    expect(isTagCoveredByRegistry('[GATT:meshcore]', keys)).toBe('[GATT:meshcore]');
    expect(isTagCoveredByRegistry('[GATT:abc]', keys)).toBe('[GATT:');
    expect(isTagCoveredByRegistry('[meshcoreRoomSession]', keys)).toBe('[meshcoreRoom');
    expect(isTagCoveredByRegistry('[TotallyUnknown]', keys)).toBeNull();
  });
});
