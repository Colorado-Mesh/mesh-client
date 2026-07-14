import { describe, expect, it } from 'vitest';

import {
  resolveReticulumSelfDisplayName,
  resolveReticulumSelfFullLabel,
  resolveReticulumSelfHeaderLabel,
} from './reticulumSelfNodeLabel';

describe('reticulumSelfNodeLabel', () => {
  const hash = 'f8b4e04e1234567890abcdef';

  it('prefers identity display name over stored longName', () => {
    expect(
      resolveReticulumSelfDisplayName({
        identityDisplayName: 'NV0N',
        lxmfHash: hash,
        storedLongName: 'f8b4e04e1234',
      }),
    ).toBe('NV0N');
  });

  it('ignores hash-prefix identity names and stored longName stubs', () => {
    expect(
      resolveReticulumSelfDisplayName({
        identityDisplayName: 'f8b4e04e1234',
        lxmfHash: hash,
        storedLongName: 'f8b4e04e1234',
      }),
    ).toBeUndefined();
  });

  it('uses stored longName when identity display name is missing', () => {
    expect(
      resolveReticulumSelfDisplayName({
        identityDisplayName: null,
        lxmfHash: hash,
        storedLongName: 'Mother',
      }),
    ).toBe('Mother');
  });

  it('header label is empty when no real display name', () => {
    expect(
      resolveReticulumSelfHeaderLabel({
        identityDisplayName: null,
        lxmfHash: hash,
        storedLongName: 'f8b4e04e1234',
      }),
    ).toBe('');
  });

  it('full label falls back to hash prefix for chat/diagnostics', () => {
    expect(
      resolveReticulumSelfFullLabel({
        identityDisplayName: null,
        lxmfHash: hash,
        storedLongName: null,
      }),
    ).toBe('f8b4e04e1234');
  });

  it('full label prefers identity display name', () => {
    expect(
      resolveReticulumSelfFullLabel({
        identityDisplayName: '  NV0N  ',
        lxmfHash: hash,
        storedLongName: 'f8b4e04e1234',
      }),
    ).toBe('NV0N');
  });
});
