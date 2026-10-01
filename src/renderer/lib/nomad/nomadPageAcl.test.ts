import { describe, expect, it } from 'vitest';

import { analyzeNomadPageAcl, appendNomadPageAclHash } from './nomadPageAcl';

const A = '0123456789abcdef0123456789abcdef';
const B = 'fedcba9876543210fedcba9876543210';

describe('analyzeNomadPageAcl', () => {
  it('accepts hashes, comments and blank lines', () => {
    expect(analyzeNomadPageAcl(`# friends\n\n${A}\n  ${B.toUpperCase()}  \n`)).toEqual({
      hashes: [A, B],
      invalidLines: [],
    });
  });

  it('reports lines rsNomad would silently ignore', () => {
    expect(analyzeNomadPageAcl(`${A}\nnot-a-hash\n${A.slice(0, 31)}\r\n${B}`)).toEqual({
      hashes: [A, B],
      invalidLines: [2, 3],
    });
  });

  it('dedupes repeated hashes case-insensitively', () => {
    expect(analyzeNomadPageAcl(`${A}\n${A.toUpperCase()}\n`).hashes).toEqual([A]);
  });

  it('treats empty text as an empty list', () => {
    expect(analyzeNomadPageAcl('')).toEqual({ hashes: [], invalidLines: [] });
  });
});

describe('appendNomadPageAclHash', () => {
  it('appends on a new line', () => {
    expect(appendNomadPageAclHash('', A)).toBe(`${A}\n`);
    expect(appendNomadPageAclHash(`# x\n${B}`, A)).toBe(`# x\n${B}\n${A}\n`);
    expect(appendNomadPageAclHash(`${B}\n`, A.toUpperCase())).toBe(`${B}\n${A}\n`);
  });

  it('leaves the text alone when the hash is already listed or invalid', () => {
    expect(appendNomadPageAclHash(`${A.toUpperCase()}\n`, A)).toBe(`${A.toUpperCase()}\n`);
    expect(appendNomadPageAclHash(`${B}\n`, 'nope')).toBe(`${B}\n`);
  });
});
