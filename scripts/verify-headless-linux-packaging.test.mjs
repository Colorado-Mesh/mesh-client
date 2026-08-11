// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { fail, isArm64Name, isX64Name } from './verify-headless-linux-packaging.mjs';

describe('verify-headless-linux-packaging helpers', () => {
  it('isX64Name matches tar.gz without an arm64 marker', () => {
    expect(isX64Name('mesh-client-1.2.3.tar.gz')).toBe(true);
    expect(isX64Name('mesh-client_1.2.3_x64.tar.gz')).toBe(true);
  });

  it('isX64Name rejects arm64, aarch64, and non-tar.gz names', () => {
    expect(isX64Name('mesh-client-1.2.3-arm64.tar.gz')).toBe(false);
    expect(isX64Name('mesh-client-1.2.3-aarch64.tar.gz')).toBe(false);
    expect(isX64Name('mesh-client-1.2.3.AppImage')).toBe(false);
    expect(isX64Name('mesh-client-1.2.3.deb')).toBe(false);
  });

  it('isArm64Name matches arm64 and aarch64 markers', () => {
    expect(isArm64Name('mesh-client-1.2.3-arm64.tar.gz')).toBe(true);
    expect(isArm64Name('mesh-client-1.2.3-aarch64.tar.gz')).toBe(true);
    expect(isArm64Name('mesh-client-1.2.3.tar.gz')).toBe(false);
  });

  it('fail exits with a prefixed error message', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      fail('broken');
      expect(exit).toHaveBeenCalledWith(1);
      expect(error.mock.calls[0][0]).toContain('[verify-headless-linux-packaging] broken');
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });
});
