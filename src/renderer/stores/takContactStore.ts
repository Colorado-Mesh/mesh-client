import { create } from 'zustand';

import type { TAKContact, TAKContactsUpdate } from '@/shared/tak-types';

const EMPTY_CONTACTS: ReadonlyMap<string, TAKContact> = new Map();

interface TakContactState {
  /** Inbound CoT contacts keyed by uid; replaced (not mutated) on every change. */
  contacts: ReadonlyMap<string, TAKContact>;
  replaceAll: (contacts: readonly TAKContact[]) => void;
  applyUpdate: (update: TAKContactsUpdate) => void;
  pruneStale: (now?: number) => void;
}

export const useTakContactStore = create<TakContactState>((set, get) => ({
  contacts: EMPTY_CONTACTS,
  replaceAll: (contacts) => {
    set({ contacts: new Map(contacts.map((c) => [c.uid, c])) });
  },
  applyUpdate: ({ upserts, removedUids }) => {
    if (upserts.length === 0 && removedUids.length === 0) return;
    const next = new Map(get().contacts);
    for (const uid of removedUids) next.delete(uid);
    for (const contact of upserts) next.set(contact.uid, contact);
    set({ contacts: next });
  },
  pruneStale: (now = Date.now()) => {
    const current = get().contacts;
    let next: Map<string, TAKContact> | null = null;
    for (const [uid, contact] of current) {
      if (contact.staleAt > now) continue;
      next ??= new Map(current);
      next.delete(uid);
    }
    if (next) set({ contacts: next });
  },
}));
