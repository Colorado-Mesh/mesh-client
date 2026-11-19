// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  compareDottedVersion,
  glibcVersionsAboveFloor,
  MAX_SIDECAR_GLIBC,
  parseGlibcVersionsFromText,
} from './check-reticulum-sidecar-glibc.mjs';

describe('check-reticulum-sidecar-glibc', () => {
  it('pins the packaging floor to Ubuntu 22.04 glibc', () => {
    expect(MAX_SIDECAR_GLIBC).toBe('2.35');
  });

  it('compares dotted glibc versions', () => {
    expect(compareDottedVersion('2.35', '2.39')).toBeLessThan(0);
    expect(compareDottedVersion('2.39', '2.35')).toBeGreaterThan(0);
    expect(compareDottedVersion('2.35', '2.35')).toBe(0);
    expect(compareDottedVersion('2.34', '2.35')).toBeLessThan(0);
  });

  it('parses GLIBC_* tokens from objdump-like text', () => {
    const text = `
0000000000000000  w   DO *UND*  0000000000000000  GLIBC_2.2.5 __cxa_finalize
0000000000000000  w   DO *UND*  0000000000000000  GLIBC_2.34  __libc_start_main
0000000000000000  w   DO *UND*  0000000000000000  GLIBC_2.39  something_new
`;
    expect(parseGlibcVersionsFromText(text)).toEqual(['2.2.5', '2.34', '2.39']);
  });

  it('flags versions above the floor (regression for ubuntu-latest builds)', () => {
    expect(glibcVersionsAboveFloor(['2.2.5', '2.34', '2.35'])).toEqual([]);
    expect(glibcVersionsAboveFloor(['2.2.5', '2.35', '2.39'])).toEqual(['2.39']);
    expect(glibcVersionsAboveFloor(['2.38', '2.39'], '2.35')).toEqual(['2.38', '2.39']);
  });
});
