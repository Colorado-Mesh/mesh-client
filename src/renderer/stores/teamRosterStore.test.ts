import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TEAM_ROSTER_UNAVAILABLE_MESSAGE } from '@/shared/teamRosterUnavailable';

import {
  hydrateTeamRosterStore,
  refreshTeamRosterStoreFromDb,
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
  it('sets hydrateError when listTeamMembers fails', async () => {
    mockDb({
      listTeamMembers: vi.fn().mockRejectedValue(new Error('db locked')),
    });
    await hydrateTeamRosterStore();
    const { hydrated, hydrateError, hydrateUnavailable, members } = useTeamRosterStore.getState();
    expect(hydrated).toBe(false);
    expect(hydrateError).toBe(true);
    expect(hydrateUnavailable).toBe(false);
    expect(members).toEqual([]);
  });

  it('refreshFromDb bypasses hydrated guard and reloads members', async () => {
    const member = {
      unitId: 3,
      callsign: 'Charlie',
      role: null,
      isSelf: false,
      onRoster: true,
      createdAt: 1,
      updatedAt: 1,
      links: [],
    };
    const listTeamMembers = vi.fn().mockResolvedValue([member]);
    mockDb({ listTeamMembers });
    useTeamRosterStore.setState({ hydrated: true, members: [] });
    await refreshTeamRosterStoreFromDb();
    expect(listTeamMembers).toHaveBeenCalled();
    expect(useTeamRosterStore.getState().members).toEqual([member]);
  });

  it('flags hydrateUnavailable when IPC reports team roster unavailable', async () => {
    mockDb({
      listTeamMembers: vi.fn().mockRejectedValue(new Error(TEAM_ROSTER_UNAVAILABLE_MESSAGE)),
    });
    await hydrateTeamRosterStore();
    const { hydrateError, hydrateUnavailable } = useTeamRosterStore.getState();
    expect(hydrateError).toBe(true);
    expect(hydrateUnavailable).toBe(true);
  });

  it('hydrates members from IPC', async () => {
    const listTeamMembers = vi.fn().mockResolvedValue([
      {
        unitId: 2,
        callsign: 'Bravo',
        role: null,

        isSelf: false,
        onRoster: false,
        createdAt: 1,
        updatedAt: 1,
        links: [],
      },
      {
        unitId: 1,
        callsign: 'Alpha',
        role: 'IC',

        isSelf: true,
        onRoster: true,
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

          isSelf: true,
          onRoster: false,
          createdAt: 1,
          updatedAt: 1,
          links: [],
        },
      ]),
      upsertTeamMember: vi.fn().mockResolvedValue({
        unitId: 2,
        callsign: 'B',
        role: null,

        isSelf: true,
        onRoster: false,
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

          isSelf: false,
          onRoster: false,
          createdAt: 1,
          updatedAt: 1,
          links: [],
        },
      ]),
      setTeamMemberLink: vi.fn().mockResolvedValue({
        unitId: 1,
        callsign: 'A',
        role: null,

        isSelf: false,
        onRoster: false,
        createdAt: 1,
        updatedAt: 2,
        links: [{ protocol: 'meshtastic', durableKey: '9', nodeId: 9, onRoster: false }],
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

  it('removeLink passes durableKey to IPC', async () => {
    const removeTeamMemberLink = vi.fn().mockResolvedValue({
      unitId: 1,
      callsign: 'A',
      role: null,

      isSelf: false,
      onRoster: false,
      createdAt: 1,
      updatedAt: 2,
      links: [],
    });
    mockDb({
      listTeamMembers: vi.fn().mockResolvedValue([
        {
          unitId: 1,
          callsign: 'A',
          role: null,

          isSelf: false,
          onRoster: false,
          createdAt: 1,
          updatedAt: 1,
          links: [{ protocol: 'meshtastic', durableKey: '9', nodeId: 9, onRoster: false }],
        },
      ]),
      removeTeamMemberLink,
    });
    await hydrateTeamRosterStore();
    await useTeamRosterStore.getState().removeLink(1, 'meshtastic', '9');
    expect(removeTeamMemberLink).toHaveBeenCalledWith(1, 'meshtastic', '9');
  });

  it('clearAll empties members', async () => {
    mockDb({
      listTeamMembers: vi.fn().mockResolvedValue([
        {
          unitId: 1,
          callsign: 'A',
          role: null,

          isSelf: false,
          onRoster: false,
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
