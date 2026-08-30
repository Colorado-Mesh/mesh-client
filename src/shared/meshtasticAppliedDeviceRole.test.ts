import { describe, expect, it } from 'vitest';

import {
  meshtasticDeviceRoleFromConfigSlice,
  resolveAppliedMeshtasticDeviceRole,
} from './meshtasticAppliedDeviceRole';

describe('resolveAppliedMeshtasticDeviceRole', () => {
  it('prefers device config role over NodeDB when they disagree', () => {
    expect(resolveAppliedMeshtasticDeviceRole(1, 0)).toBe(1);
    expect(resolveAppliedMeshtasticDeviceRole(0, 1)).toBe(0);
  });

  it('falls back to NodeDB when config role is missing', () => {
    expect(resolveAppliedMeshtasticDeviceRole(null, 2)).toBe(2);
    expect(resolveAppliedMeshtasticDeviceRole(undefined, 1)).toBe(1);
  });

  it('returns null when neither source has a role', () => {
    expect(resolveAppliedMeshtasticDeviceRole(null, null)).toBeNull();
  });
});

describe('meshtasticDeviceRoleFromConfigSlice', () => {
  it('reads numeric role from device slice', () => {
    expect(meshtasticDeviceRoleFromConfigSlice({ role: 1 })).toBe(1);
    expect(meshtasticDeviceRoleFromConfigSlice({ role: '1' })).toBeNull();
  });
});
