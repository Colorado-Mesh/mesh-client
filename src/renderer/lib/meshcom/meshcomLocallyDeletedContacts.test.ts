import { afterEach, describe, expect, it } from 'vitest';

import {
  clearAllMeshcomLocallyDeletedContactsForTests,
  clearMeshcomLocallyDeletedContact,
  isMeshcomLocallyDeletedContact,
  markMeshcomLocallyDeletedContact,
  shouldApplyMeshcomContact,
} from './meshcomLocallyDeletedContacts';

describe('meshcomLocallyDeletedContacts', () => {
  afterEach(() => {
    clearAllMeshcomLocallyDeletedContactsForTests();
  });

  it('tombstones a normalized callsign and blocks apply', () => {
    markMeshcomLocallyDeletedContact('oe1kfr-01');
    expect(isMeshcomLocallyDeletedContact('OE1KFR-1')).toBe(true);
    expect(shouldApplyMeshcomContact('OE1KFR-1')).toBe(false);
  });

  it('clear restores apply', () => {
    markMeshcomLocallyDeletedContact('W1AW-1');
    clearMeshcomLocallyDeletedContact('W1AW-1');
    expect(shouldApplyMeshcomContact('W1AW-1')).toBe(true);
  });
});
