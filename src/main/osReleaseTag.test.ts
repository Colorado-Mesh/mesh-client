import type { execFileSync } from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readWindowsUpdateBuildRevision,
  resetOsReleaseTagCacheForTests,
  resolveOsReleaseObservation,
  resolveOsReleaseTag,
} from './osReleaseTag';

describe('osReleaseTag', () => {
  afterEach(() => {
    resetOsReleaseTagCacheForTests();
  });

  it('resolveOsReleaseTag returns the base release on non-Windows', () => {
    expect(resolveOsReleaseTag('darwin', '24.0.0', () => 99)).toBe('24.0.0');
    expect(resolveOsReleaseTag('linux', '6.8.0-31-generic', () => 99)).toBe('6.8.0-31-generic');
  });

  it('resolveOsReleaseTag appends Windows UBR when missing', () => {
    expect(resolveOsReleaseTag('win32', '10.0.26200', () => 9974)).toBe('10.0.26200.9974');
  });

  it('resolveOsReleaseTag does not double-append an existing UBR suffix', () => {
    expect(resolveOsReleaseTag('win32', '10.0.26200.9974', () => 9974)).toBe('10.0.26200.9974');
  });

  it('resolveOsReleaseTag keeps the base release when UBR is unavailable', () => {
    expect(resolveOsReleaseTag('win32', '10.0.26200', () => null)).toBe('10.0.26200');
  });

  it('resolveOsReleaseTag caches the value for the live process platform', () => {
    const readUbr = vi.fn(() => 10075);
    const first = resolveOsReleaseTag(process.platform, '10.0.26200', readUbr);
    const second = resolveOsReleaseTag(process.platform, '10.0.26200', readUbr);
    expect(first).toBe(second);
    expect(readUbr).toHaveBeenCalledTimes(process.platform === 'win32' ? 1 : 0);
  });

  it('resolveOsReleaseObservation retains UBR from the same registry read as the tag', () => {
    const readUbr = vi.fn(() => 9974);
    const first = resolveOsReleaseObservation('win32', '10.0.26200', readUbr);
    expect(first).toEqual({ tag: '10.0.26200.9974', ubr: 9974 });
    // Process-lifetime cache only applies when `platform` matches the live OS.
    if (process.platform === 'win32') {
      const second = resolveOsReleaseObservation('win32', '10.0.26200', readUbr);
      expect(second).toBe(first);
      expect(readUbr).toHaveBeenCalledTimes(1);
    }
  });

  it('resolveOsReleaseObservation omits UBR when the registry read fails', () => {
    expect(resolveOsReleaseObservation('win32', '10.0.26200', () => null)).toEqual({
      tag: '10.0.26200',
      ubr: null,
    });
  });

  it('readWindowsUpdateBuildRevision returns null on non-Windows', () => {
    const execFile = vi.fn(() => '') as unknown as typeof execFileSync;
    expect(readWindowsUpdateBuildRevision(execFile, 'darwin')).toBeNull();
    expect(execFile).not.toHaveBeenCalled();
  });

  it('readWindowsUpdateBuildRevision parses REG_DWORD hex from reg.exe', () => {
    const execFile = vi.fn(
      () =>
        '\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\n    UBR    REG_DWORD    0x26fe\n',
    ) as unknown as typeof execFileSync;
    expect(readWindowsUpdateBuildRevision(execFile, 'win32')).toBe(0x26fe);
    expect(execFile).toHaveBeenCalledWith(
      'reg.exe',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', '/v', 'UBR'],
      expect.objectContaining({ encoding: 'utf8', windowsHide: true }),
    );
  });

  it('readWindowsUpdateBuildRevision returns null when reg.exe fails', () => {
    const execFile = vi.fn(() => {
      throw new Error('boom');
    }) as unknown as typeof execFileSync;
    expect(readWindowsUpdateBuildRevision(execFile, 'win32')).toBeNull();
  });
});
