import { describe, expect, it } from 'vitest';

import { isValidXmodemRemoteFilename } from './xmodemFilename';

describe('isValidXmodemRemoteFilename', () => {
  it('accepts simple filenames', () => {
    expect(isValidXmodemRemoteFilename('config.txt')).toBe(true);
  });

  it('rejects path separators and traversal', () => {
    expect(isValidXmodemRemoteFilename('../etc/passwd')).toBe(false);
    expect(isValidXmodemRemoteFilename('dir/file.txt')).toBe(false);
    expect(isValidXmodemRemoteFilename('dir\\file.txt')).toBe(false);
  });

  it('rejects empty and null bytes', () => {
    expect(isValidXmodemRemoteFilename('   ')).toBe(false);
    expect(isValidXmodemRemoteFilename('bad\0name')).toBe(false);
  });
});
