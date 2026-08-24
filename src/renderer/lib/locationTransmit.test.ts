import { afterEach, describe, expect, it, vi } from 'vitest';

import * as appSettingsStorage from '@/renderer/lib/appSettingsStorage';
import { canTransmitLocation, MESHTASTIC_ROLE_CLIENT_MUTE } from '@/renderer/lib/locationTransmit';

describe('canTransmitLocation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    { shareMyLocation: false, protocol: 'meshtastic' as const, role: 0, expected: false },
    { shareMyLocation: false, protocol: 'meshcore' as const, role: null, expected: false },
    {
      shareMyLocation: true,
      protocol: 'meshtastic' as const,
      role: MESHTASTIC_ROLE_CLIENT_MUTE,
      expected: false,
    },
    { shareMyLocation: true, protocol: 'meshtastic' as const, role: 0, expected: true },
    { shareMyLocation: true, protocol: 'meshcore' as const, role: null, expected: true },
    { shareMyLocation: true, protocol: 'reticulum' as const, role: null, expected: true },
  ])(
    'shareMyLocation=$shareMyLocation protocol=$protocol role=$role => $expected',
    ({ shareMyLocation, protocol, role, expected }) => {
      vi.spyOn(appSettingsStorage, 'isShareMyLocationEnabled').mockReturnValue(shareMyLocation);
      expect(
        canTransmitLocation({
          protocol,
          meshtasticRole: role,
        }),
      ).toBe(expected);
    },
  );

  it('defaults shareMyLocation to true when unset', () => {
    vi.spyOn(appSettingsStorage, 'isShareMyLocationEnabled').mockReturnValue(true);
    expect(canTransmitLocation({ protocol: 'meshcore' })).toBe(true);
  });
});
