import { describe, expect, it } from 'vitest';

import { resolveReticulumDestinationHash } from './destHash';
import {
  isReticulumLxmfLink,
  openReticulumDmFromHash,
  parseReticulumDestinationInput,
  parseReticulumLxmfLinkUrl,
} from './reticulumDestinationInput';

const HASH = '368f994c056de0d8882855eb0d627497';

describe('parseReticulumDestinationInput', () => {
  it('parses bare 32-char hex', () => {
    expect(parseReticulumDestinationInput(HASH)).toBe(HASH);
    expect(parseReticulumDestinationInput(HASH.toUpperCase())).toBe(HASH);
  });

  it('parses lxmf:// scheme', () => {
    expect(parseReticulumDestinationInput(`lxmf://${HASH}`)).toBe(HASH);
  });

  it('parses lxmf@ shorthand', () => {
    expect(parseReticulumDestinationInput(`lxmf@${HASH}`)).toBe(HASH);
  });

  it('parses lxmf.delivery@ aspect', () => {
    expect(parseReticulumDestinationInput(`lxmf.delivery@${HASH}`)).toBe(HASH);
  });

  it('strips angle brackets and quotes', () => {
    expect(parseReticulumDestinationInput(`<${HASH}>`)).toBe(HASH);
    expect(parseReticulumDestinationInput(`"${HASH}"`)).toBe(HASH);
  });

  it('returns null for invalid input', () => {
    expect(parseReticulumDestinationInput('')).toBeNull();
    expect(parseReticulumDestinationInput('not-a-hash')).toBeNull();
    expect(parseReticulumDestinationInput('abc')).toBeNull();
    expect(parseReticulumDestinationInput('lxmf://tooshort')).toBeNull();
  });
});

describe('isReticulumLxmfLink', () => {
  it('detects lxmf schemes and aspects', () => {
    expect(isReticulumLxmfLink(`lxmf://${HASH}`)).toBe(true);
    expect(isReticulumLxmfLink(`lxmf@${HASH}`)).toBe(true);
    expect(isReticulumLxmfLink(`lxmf.delivery@${HASH}`)).toBe(true);
  });

  it('does not treat bare hash as lxmf link', () => {
    expect(isReticulumLxmfLink(HASH)).toBe(false);
    expect(isReticulumLxmfLink(`${HASH}:/page/index.mu`)).toBe(false);
  });
});

describe('parseReticulumLxmfLinkUrl', () => {
  it('parses lxmf links only', () => {
    expect(parseReticulumLxmfLinkUrl(`lxmf://${HASH}`)).toBe(HASH);
    expect(parseReticulumLxmfLinkUrl(HASH)).toBeNull();
  });
});

describe('openReticulumDmFromHash', () => {
  it('registers hash and returns node id', () => {
    const nodeId = openReticulumDmFromHash(HASH);
    expect(nodeId).toBeGreaterThan(0);
    expect(resolveReticulumDestinationHash(nodeId)).toBe(HASH);
  });

  it('throws on invalid hash', () => {
    expect(() => openReticulumDmFromHash('bad')).toThrow('Invalid Reticulum destination hash');
  });
});
