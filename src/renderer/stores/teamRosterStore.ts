import { create } from 'zustand';

import type { MeshProtocol } from '@/shared/meshProtocol';
import type { TeamMember, TeamMemberInput, TeamMemberLinkInput } from '@/shared/teamRosterTypes';

interface TeamRosterState {
  hydrated: boolean;
  members: TeamMember[];
  hydrate: () => Promise<void>;
  upsertMember: (input: TeamMemberInput) => Promise<TeamMember>;
  deleteMember: (unitId: number) => Promise<void>;
  setLink: (input: TeamMemberLinkInput) => Promise<TeamMember>;
  removeLink: (unitId: number, protocol: MeshProtocol) => Promise<TeamMember>;
  allocateUnitId: () => Promise<number>;
  clearAll: () => Promise<void>;
}

let hydration: Promise<void> | null = null;

function replaceMember(members: TeamMember[], member: TeamMember): TeamMember[] {
  const idx = members.findIndex((m) => m.unitId === member.unitId);
  if (idx < 0) {
    return [...members, member].sort((a, b) => a.unitId - b.unitId);
  }
  const next = members.slice();
  next[idx] = member;
  return next;
}

export const useTeamRosterStore = create<TeamRosterState>((set, get) => ({
  hydrated: false,
  members: [],

  hydrate: async () => {
    if (get().hydrated) return;
    if (hydration) return hydration;
    const list = window.electronAPI?.db?.listTeamMembers;
    if (!list) {
      set({ hydrated: true });
      return;
    }
    hydration = (async () => {
      try {
        const members = await list();
        set({
          members: [...members].sort((a, b) => a.unitId - b.unitId),
          hydrated: true,
        });
      } catch (error) {
        console.warn('[teamRoster] hydrate failed:', error);
      } finally {
        hydration = null;
      }
    })();
    return hydration;
  },

  upsertMember: async (input) => {
    try {
      const member = await window.electronAPI.db.upsertTeamMember(input);
      set((s) => ({
        members: replaceMember(
          // Clearing other isSelf in the UI when SQLite already cleared them on upsert.
          input.isSelf
            ? s.members.map((m) => (m.unitId === member.unitId ? m : { ...m, isSelf: false }))
            : s.members,
          member,
        ),
      }));
      return member;
    } catch (error) {
      console.warn('[teamRoster] upsert failed:', error);
      throw error;
    }
  },

  deleteMember: async (unitId) => {
    try {
      await window.electronAPI.db.deleteTeamMember(unitId);
      set((s) => ({ members: s.members.filter((m) => m.unitId !== unitId) }));
    } catch (error) {
      console.warn('[teamRoster] delete failed:', error);
      throw error;
    }
  },

  setLink: async (input) => {
    try {
      const member = await window.electronAPI.db.setTeamMemberLink(input);
      set((s) => ({ members: replaceMember(s.members, member) }));
      return member;
    } catch (error) {
      console.warn('[teamRoster] setLink failed:', error);
      throw error;
    }
  },

  removeLink: async (unitId, protocol) => {
    try {
      const member = await window.electronAPI.db.removeTeamMemberLink(unitId, protocol);
      set((s) => ({ members: replaceMember(s.members, member) }));
      return member;
    } catch (error) {
      console.warn('[teamRoster] removeLink failed:', error);
      throw error;
    }
  },

  allocateUnitId: async () => {
    try {
      return await window.electronAPI.db.allocateTeamUnitId();
    } catch (error) {
      console.warn('[teamRoster] allocateUnitId failed:', error);
      throw error;
    }
  },

  clearAll: async () => {
    try {
      await window.electronAPI.db.clearTeamMembers();
      set({ members: [] });
    } catch (error) {
      console.warn('[teamRoster] clearAll failed:', error);
      throw error;
    }
  },
}));

/** Await before mounting Team Contacts / Team Roster panels. Safe to call repeatedly. */
export function hydrateTeamRosterStore(): Promise<void> {
  return useTeamRosterStore.getState().hydrate();
}

export function resetTeamRosterStoreForTests(): void {
  hydration = null;
  useTeamRosterStore.setState({
    hydrated: false,
    members: [],
  });
}
