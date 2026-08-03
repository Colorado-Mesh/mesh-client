import { describe, expect, it } from 'vitest';

import { isRemoteOkFailure } from './remote-types';

describe('isRemoteOkFailure', () => {
  it('is false when ok is missing (legacy listener status shape)', () => {
    expect(
      isRemoteOkFailure({
        enabled: false,
        inbound_mode: 'off',
        allowed: [],
        blocked: [],
      }),
    ).toBe(false);
  });

  it('is false when ok is true', () => {
    expect(isRemoteOkFailure({ ok: true })).toBe(false);
  });

  it('is true when ok is false', () => {
    expect(isRemoteOkFailure({ ok: false, error: 'save_dir_not_from_picker' })).toBe(true);
  });

  it('is false for null/non-objects', () => {
    expect(isRemoteOkFailure(null)).toBe(false);
    expect(isRemoteOkFailure(undefined)).toBe(false);
    expect(isRemoteOkFailure('ok')).toBe(false);
  });
});
