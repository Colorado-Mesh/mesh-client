import { describe, expect, it } from 'vitest';

import { isHarmlessSocketOptionError } from './harmlessSocketOptionError';

/**
 * The filter keeps undici's advisory ToS marking failures out of the crash dialog.
 * Match strategy is intentionally narrow (syscall name AND EINVAL), so these tests
 * fail if it ever broadens into "swallow every EINVAL".
 */
function tosError(code?: string, message = 'setTypeOfService EINVAL'): Error {
  const err = new Error(message);
  if (code !== undefined) {
    Object.assign(err, { code });
  }
  return err;
}

describe('isHarmlessSocketOptionError', () => {
  it('matches the canonical undici shape with an EINVAL code', () => {
    expect(isHarmlessSocketOptionError(tosError('EINVAL'))).toBe(true);
  });

  it('matches when only the message carries EINVAL', () => {
    expect(isHarmlessSocketOptionError(tosError())).toBe(true);
  });

  it('rejects the same syscall with a contradicting code', () => {
    expect(isHarmlessSocketOptionError(tosError('EACCES'))).toBe(false);
    expect(isHarmlessSocketOptionError(tosError('EPERM'))).toBe(false);
  });

  it('rejects unrelated EINVAL errors', () => {
    expect(isHarmlessSocketOptionError(tosError('EINVAL', 'bind EINVAL 0.0.0.0:80'))).toBe(false);
    expect(isHarmlessSocketOptionError(new Error('EINVAL'))).toBe(false);
  });

  it('rejects a setTypeOfService error without EINVAL anywhere', () => {
    expect(isHarmlessSocketOptionError(new Error('setTypeOfService ENOTSUP'))).toBe(false);
  });

  it('rejects non-Error values', () => {
    expect(isHarmlessSocketOptionError('setTypeOfService EINVAL')).toBe(false);
    expect(isHarmlessSocketOptionError(undefined)).toBe(false);
    expect(isHarmlessSocketOptionError(null)).toBe(false);
    expect(isHarmlessSocketOptionError({ message: 'setTypeOfService EINVAL' })).toBe(false);
  });
});
