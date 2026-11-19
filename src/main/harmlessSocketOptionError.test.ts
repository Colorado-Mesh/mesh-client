import { describe, expect, it } from 'vitest';

import {
  isHarmlessSocketOptionError,
  isHarmlessStdioBrokenPipeError,
} from './harmlessSocketOptionError';

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

function errnoError(code: string | undefined, message: string, stack?: string): Error {
  const err = new Error(message);
  if (code !== undefined) {
    Object.assign(err, { code });
  }
  if (stack !== undefined) {
    err.stack = stack;
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

describe('isHarmlessStdioBrokenPipeError', () => {
  it('matches console→stdio EPIPE with WriteToConsole stack frame', () => {
    const err = errnoError(
      'EPIPE',
      'write EPIPE',
      'Error: write EPIPE\n    at afterWriteDispatched\n    at [kWriteToConsole]\n    at console.error',
    );
    expect(isHarmlessStdioBrokenPipeError(err)).toBe(true);
  });

  it('matches when code is absent but message and console stack agree', () => {
    const err = errnoError(
      undefined,
      'write EPIPE',
      'Error: write EPIPE\n    at console.warn (node:internal/console/constructor:1:1)',
    );
    expect(isHarmlessStdioBrokenPipeError(err)).toBe(true);
  });

  it('rejects TCP-style write EPIPE without a console/stdio stack frame', () => {
    const err = errnoError(
      'EPIPE',
      'write EPIPE',
      'Error: write EPIPE\n    at Socket._write (node:net:1:1)\n    at TakRemoteClient.write',
    );
    expect(isHarmlessStdioBrokenPipeError(err)).toBe(false);
  });

  it('rejects when console.error appears only in the error message header', () => {
    const err = errnoError(
      'EPIPE',
      'write EPIPE via console.error',
      'Error: write EPIPE via console.error\n    at Socket._write (node:net:1:1)\n    at someTcpWrite',
    );
    expect(isHarmlessStdioBrokenPipeError(err)).toBe(false);
  });

  it('rejects non-EPIPE codes even with a console stack', () => {
    const err = errnoError(
      'EIO',
      'write EIO',
      'Error: write EIO\n    at [kWriteToConsole]\n    at console.error',
    );
    expect(isHarmlessStdioBrokenPipeError(err)).toBe(false);
  });

  it('rejects non-Error values', () => {
    expect(isHarmlessStdioBrokenPipeError('write EPIPE')).toBe(false);
    expect(isHarmlessStdioBrokenPipeError(undefined)).toBe(false);
    expect(isHarmlessStdioBrokenPipeError({ message: 'write EPIPE', code: 'EPIPE' })).toBe(false);
  });
});
