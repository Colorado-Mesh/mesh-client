import { describe, expect, it } from 'vitest';

import {
  activeInterfaceProfileId,
  applyInterfaceEnableSet,
  createInterfaceProfile,
  deleteInterfaceProfile,
  emptyInterfaceProfilesState,
  enabledInterfaceNames,
  isSystemManagedInterfaceProfileName,
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
    expect(res.needsRestartHint).toBe(true);
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
    expect(res.needsRestartHint).toBe(false);
    expect(calls).toEqual([{ id: 'a', enabled: false }]);
  });

  it('hints restart once for multiple restart-requiring enables', async () => {
    const rows = [
      { id: 'tcp-1', name: 'Hub A', enabled: false, type: 'tcp' },
      { id: 'tcp-2', name: 'Hub B', enabled: false, type: 'tcp' },
      { id: 'auto-1', name: 'LAN', enabled: true, type: 'auto' },
    ];
    const calls: { id: string; enabled: boolean; type?: string }[] = [];
    const res = await applyInterfaceEnableSet(
      rows,
      new Set(['Hub A', 'Hub B']),
      (id, enabled, type) => {
        calls.push({ id, enabled, type });
      },
    );
    expect(res.ok).toBe(true);
    expect(res.needsRestartHint).toBe(true);
    expect(calls).toEqual([
      { id: 'tcp-1', enabled: true, type: 'tcp' },
      { id: 'tcp-2', enabled: true, type: 'tcp' },
      { id: 'auto-1', enabled: false, type: 'auto' },
    ]);
  });

  it('does not hint restart for hot-applied enable-only changes', async () => {
    const rows = [
      { id: 'hot-1', name: 'Hot', enabled: false, type: 'custom_hot' },
      { id: 'tcp-1', name: 'Hub', enabled: true, type: 'tcp' },
    ];
    const res = await applyInterfaceEnableSet(rows, new Set(['Hot']), () => true);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.needsRestartHint).toBe(false);
  });

  it.each([
    { name: 'SharedInstanceServer', id: 'rns-0' },
    { name: 'SharedInstanceClient', id: 'rns-client' },
  ] as const)(
    'skips $name when applying empty profile and omits it from saved members',
    async ({ name, id }) => {
      expect(isSystemManagedInterfaceProfileName(name)).toBe(true);
      const withShared = [
        ...ifaces,
        {
          id,
          name,
          enabled: true,
          type: 'Full',
        },
      ];
      const calls: { id: string; enabled: boolean }[] = [];
      const res = await applyInterfaceEnableSet(withShared, new Set(), (ifaceId, enabled) => {
        calls.push({ id: ifaceId, enabled });
      });
      expect(res.ok).toBe(true);
      expect(res.changed).toBe(true);
      expect(calls.some((c) => c.id === id)).toBe(false);
      expect(calls).toEqual([
        { id: 'a', enabled: false },
        { id: 'c', enabled: false },
      ]);

      const state = saveCurrentAsInterfaceProfile(
        emptyInterfaceProfilesState(),
        'Home',
        withShared,
      );
      expect(state.profiles[0]?.members).toEqual(['Alpha', 'Gamma']);
      expect(activeInterfaceProfileId(state, withShared)).toBe(state.profiles[0]?.id);
      expect(activeInterfaceProfileId(state, ifaces)).toBe(state.profiles[0]?.id);
    },
  );
});
