import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearMeshcoreLocallyDeletedContact,
  filterOutMeshcoreLocallyDeletedContacts,
  isMeshcoreLocallyDeletedContact,
  markMeshcoreLocallyDeletedContact,
  resetMeshcoreLocallyDeletedContactsForTests,
  shouldApplyMeshcoreContact,
} from './meshcoreLocallyDeletedContacts';

describe('meshcoreLocallyDeletedContacts', () => {
  beforeEach(() => {
    resetMeshcoreLocallyDeletedContactsForTests();
  });

  it('tracks and filters deleted contact ids', () => {
    markMeshcoreLocallyDeletedContact(0xabc);
    expect(isMeshcoreLocallyDeletedContact(0xabc)).toBe(true);
    expect(shouldApplyMeshcoreContact(0xabc)).toBe(false);
    expect(shouldApplyMeshcoreContact(0xdef)).toBe(true);
    const nodes = new Map([
      [0xabc, { name: 'gone' }],
      [0xdef, { name: 'keep' }],
    ]);
    const filtered = filterOutMeshcoreLocallyDeletedContacts(nodes);
    expect(filtered.has(0xabc)).toBe(false);
    expect(filtered.get(0xdef)?.name).toBe('keep');
    clearMeshcoreLocallyDeletedContact(0xabc);
    expect(isMeshcoreLocallyDeletedContact(0xabc)).toBe(false);
  });
});
