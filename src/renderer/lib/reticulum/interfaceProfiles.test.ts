import { describe, expect, it } from 'vitest';

import {
  activeInterfaceProfileId,
  applyInterfaceEnableSet,
  createInterfaceProfile,
  deleteInterfaceProfile,
  emptyInterfaceProfilesState,
  enabledInterfaceNames,
  renameInterfaceProfile,
  saveCurrentAsInterfaceProfile,
  updateDefaultInterfaceMembersIfCustom,
} from './interfaceProfiles';

const ifaces = [
  { id: 'a', name: 'Alpha', enabled: true, type: 'tcp' },
  { id: 'b', name: 'Beta', enabled: false, type: 'tcp' },
  { id: 'c', name: 'Gamma', enabled: true, type: 'auto' },
];

describe('interfaceProfiles', () => {
  it('tracks enabled names and active profile match', () => {
    expect([...enabledInterfaceNames(ifaces)].sort()).toEqual(['Alpha', 'Gamma']);
    let state = emptyInterfaceProfilesState();
    state = saveCurrentAsInterfaceProfile(state, 'Dual', ifaces);
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]?.members.sort()).toEqual(['Alpha', 'Gamma']);
    expect(activeInterfaceProfileId(state, ifaces)).toBe(state.profiles[0]?.id);
  });

  it('create / rename / delete', () => {
    let state = createInterfaceProfile(emptyInterfaceProfilesState(), 'One', ['Alpha']);
    const id = state.profiles[0].id;
    state = renameInterfaceProfile(state, id, 'Two');
    expect(state.profiles[0]?.name).toBe('Two');
    state = deleteInterfaceProfile(state, id);
    expect(state.profiles).toHaveLength(0);
  });

  it('updates default members when live set is custom', () => {
    let state = saveCurrentAsInterfaceProfile(emptyInterfaceProfilesState(), 'Dual', ifaces);
    const custom = ifaces.map((i) =>
      i.name === 'Beta' ? { ...i, enabled: true } : { ...i, enabled: false },
    );
    state = updateDefaultInterfaceMembersIfCustom(state, custom);
    expect(state.defaultMembers).toEqual(['Beta']);
  });

  it('does not invent Default members when live set matches a named profile', () => {
    let state = saveCurrentAsInterfaceProfile(emptyInterfaceProfilesState(), 'Dual', ifaces);
    expect(state.defaultMembers).toBeNull();
    state = updateDefaultInterfaceMembersIfCustom(state, ifaces);
    expect(state.defaultMembers).toBeNull();
  });

  it('applies enable set via toggles', async () => {
    const calls: { id: string; enabled: boolean }[] = [];
    const res = await applyInterfaceEnableSet(ifaces, new Set(['Beta']), (id, enabled) => {
      calls.push({ id, enabled });
    });
    expect(res.changed).toBe(true);
    expect(res.ok).toBe(true);
    expect(calls).toEqual([
      { id: 'a', enabled: false },
      { id: 'b', enabled: true },
      { id: 'c', enabled: false },
    ]);
  });

  it('stops applying enable set when a toggle fails', async () => {
    const calls: { id: string; enabled: boolean }[] = [];
    const res = await applyInterfaceEnableSet(ifaces, new Set(['Beta']), (id, enabled) => {
      calls.push({ id, enabled });
      return id !== 'a';
    });
    expect(res.ok).toBe(false);
    expect(calls).toEqual([{ id: 'a', enabled: false }]);
  });
});
