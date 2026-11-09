import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hydrateTeamRosterStore,
  resetTeamRosterStoreForTests,
  useTeamRosterStore,
} from './teamRosterStore';

beforeEach(() => {
  resetTeamRosterStoreForTests();
});

function mockDb(partial: Partial<typeof window.electronAPI.db>) {
  const list = vi.fn().mockResolvedValue([]);
  Object.assign(window.electronAPI.db, {
    listTeamMembers: list,
    allocateTeamUnitId: vi.fn().mockResolvedValue(1),
    upsertTeamMember: vi.fn(),
    deleteTeamMember: vi.fn().mockResolvedValue(undefined),
    setTeamMemberLink: vi.fn(),
    removeTeamMemberLink: vi.fn(),
    clearTeamMembers: vi.fn().mockResolvedValue(undefined),
    ...partial,
  });
  return { list };
}

describe('teamRosterStore', () => {
  it('hydrates members from IPC', async () => {
    const listTeamMembers = vi.fn().mockResolvedValue([
      {
        unitId: 2,
        callsign: 'Bravo',
        role: null,
        color: null,
        isSelf: false,
        createdAt: 1,
        updatedAt: 1,
        links: [],
      },
      {
        unitId: 1,
        callsign: 'Alpha',
        role: 'IC',
        color: null,
        isSelf: true,
        createdAt: 1,
        updatedAt: 1,
        links: [],
      },
    ]);
    mockDb({ listTeamMembers });
    await hydrateTeamRosterStore();
    const { hydrated, members } = useTeamRosterStore.getState();
    expect(hydrated).toBe(true);
    expect(listTeamMembers).toHaveBeenCalled();
    expect(members.map((m) => m.unitId)).toEqual([1, 2]);
  });

  it('upserts and clears other isSelf flags locally', async () => {
    mockDb({
      listTeamMembers: vi.fn().mockResolvedValue([
        {
          unitId: 1,
          callsign: 'A',
          role: null,
          color: null,
          isSelf: true,
          createdAt: 1,
          updatedAt: 1,
          links: [],
        },
      ]),
      upsertTeamMember: vi.fn().mockResolvedValue({
        unitId: 2,
        callsign: 'B',
        role: null,
        color: null,
        isSelf: true,
        createdAt: 2,
        updatedAt: 2,
        links: [],
      }),
    });
    await hydrateTeamRosterStore();
    await useTeamRosterStore.getState().upsertMember({
      unitId: 2,
      callsign: 'B',
      isSelf: true,
    });
    const members = useTeamRosterStore.getState().members;
    expect(members.find((m) => m.unitId === 1)?.isSelf).toBe(false);
    expect(members.find((m) => m.unitId === 2)?.isSelf).toBe(true);
  });

  it('setLink replaces the member in state', async () => {
    mockDb({
      listTeamMembers: vi.fn().mockResolvedValue([
        {
          unitId: 1,
          callsign: 'A',
          role: null,
          color: null,
          isSelf: false,
          createdAt: 1,
          updatedAt: 1,
          links: [],
        },
      ]),
      setTeamMemberLink: vi.fn().mockResolvedValue({
        unitId: 1,
        callsign: 'A',
        role: null,
        color: null,
        isSelf: false,
        createdAt: 1,
        updatedAt: 2,
        links: [{ protocol: 'meshtastic', durableKey: '9', nodeId: 9 }],
      }),
    });
    await hydrateTeamRosterStore();
    await useTeamRosterStore.getState().setLink({
      unitId: 1,
      protocol: 'meshtastic',
      durableKey: '9',
      nodeId: 9,
    });
    expect(useTeamRosterStore.getState().members[0].links).toHaveLength(1);
  });

  it('clearAll empties members', async () => {
    mockDb({
      listTeamMembers: vi.fn().mockResolvedValue([
        {
          unitId: 1,
          callsign: 'A',
          role: null,
          color: null,
          isSelf: false,
          createdAt: 1,
          updatedAt: 1,
          links: [],
        },
      ]),
    });
    await hydrateTeamRosterStore();
    await useTeamRosterStore.getState().clearAll();
    expect(useTeamRosterStore.getState().members).toEqual([]);
  });

  it('stays unhydrated when list fails so hydrate can retry', async () => {
    mockDb({
      listTeamMembers: vi.fn().mockRejectedValue(new Error('db down')),
    });
    await hydrateTeamRosterStore();
    expect(useTeamRosterStore.getState().hydrated).toBe(false);
  });
});
