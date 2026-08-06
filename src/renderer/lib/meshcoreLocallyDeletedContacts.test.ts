import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearMeshcoreLocallyDeletedContact,
  filterOutMeshcoreLocallyDeletedContacts,
  isMeshcoreLocallyDeletedContact,
  markMeshcoreLocallyDeletedContact,
  resetMeshcoreLocallyDeletedContactsForTests,
  restoreMeshcoreLocallyDeletedContactsFromStorage,
  shouldApplyMeshcoreContact,
} from './meshcoreLocallyDeletedContacts';

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: () => null,
    get length() {
      return store.size;
    },
  } satisfies Storage);
}

describe('meshcoreLocallyDeletedContacts', () => {
  beforeEach(() => {
    stubLocalStorage();
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

  it('persists tombstones across restart so stale messages cannot recreate contacts', () => {
    markMeshcoreLocallyDeletedContact(0x3456789a);
    const saved = localStorage.getItem('mesh-client:meshcoreLocallyDeletedContacts');
    expect(saved).toBeTruthy();
    // Simulate cold start: wipe memory, keep storage.
    resetMeshcoreLocallyDeletedContactsForTests();
    localStorage.setItem('mesh-client:meshcoreLocallyDeletedContacts', saved!);
    restoreMeshcoreLocallyDeletedContactsFromStorage();
    expect(shouldApplyMeshcoreContact(0x3456789a)).toBe(false);
    const stubbed = filterOutMeshcoreLocallyDeletedContacts(
      new Map([[0x3456789a, { name: 'stale-from-message' }]]),
    );
    expect(stubbed.has(0x3456789a)).toBe(false);
  });
});
