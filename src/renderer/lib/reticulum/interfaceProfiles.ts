/**
 * Named RNS interface enable-set presets (NomadNet InterfaceProfiles.py parity).
 * Persisted in localStorage; members are interface display names.
 */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

export const INTERFACE_PROFILES_STORAGE_KEY = 'mesh-client:reticulumInterfaceProfiles';
export const INTERFACE_PROFILES_VERSION = 1;

export interface InterfaceProfile {
  id: string;
  name: string;
  /** Interface config names (ReticulumInterfaceRow.name). */
  members: string[];
}

export interface InterfaceProfilesState {
  version: number;
  profiles: InterfaceProfile[];
  /** Last manual (non-profile) enabled set, when profiles exist. */
  defaultMembers: string[] | null;
}

interface StoredProfile {
  id?: unknown;
  name?: unknown;
  members?: unknown;
}

function newProfileId(existing: ReadonlySet<string>): string {
  for (;;) {
    const id = crypto
      .getRandomValues(new Uint8Array(4))
      .reduce((acc, b) => acc + b.toString(16).padStart(2, '0'), '');
    if (!existing.has(id)) return id;
  }
}

export function emptyInterfaceProfilesState(): InterfaceProfilesState {
  return { version: INTERFACE_PROFILES_VERSION, profiles: [], defaultMembers: null };
}

export function loadInterfaceProfiles(): InterfaceProfilesState {
  try {
    const raw = localStorage.getItem(INTERFACE_PROFILES_STORAGE_KEY);
    if (!raw) return emptyInterfaceProfilesState();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return emptyInterfaceProfilesState();
    const data = parsed as { profiles?: unknown; defaultMembers?: unknown };
    const seen = new Set<string>();
    const profiles: InterfaceProfile[] = [];
    const rawProfiles = Array.isArray(data.profiles) ? data.profiles : [];
    for (const entry of rawProfiles) {
      if (typeof entry !== 'object' || entry === null) continue;
      const p = entry as StoredProfile;
      const id = typeof p.id === 'string' ? p.id : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const members = Array.isArray(p.members)
        ? p.members.filter((m): m is string => typeof m === 'string' && m.length > 0)
        : [];
      const name = typeof p.name === 'string' && p.name ? p.name : 'Profile';
      profiles.push({ id, name, members });
    }
    const dm = data.defaultMembers;
    return {
      version: INTERFACE_PROFILES_VERSION,
      profiles,
      defaultMembers: Array.isArray(dm)
        ? dm.filter((m): m is string => typeof m === 'string')
        : null,
    };
  } catch (e) {
    console.warn('[interfaceProfiles] load ' + errLikeToLogString(e));
    return emptyInterfaceProfilesState();
  }
}

export function saveInterfaceProfiles(state: InterfaceProfilesState): void {
  try {
    localStorage.setItem(
      INTERFACE_PROFILES_STORAGE_KEY,
      JSON.stringify({
        version: INTERFACE_PROFILES_VERSION,
        profiles: state.profiles.map((p) => ({
          id: p.id,
          name: p.name,
          members: [...p.members],
        })),
        defaultMembers: state.defaultMembers,
      }),
    );
  } catch (e) {
    console.warn('[interfaceProfiles] save ' + errLikeToLogString(e));
  }
}

export function enabledInterfaceNames(
  interfaces: readonly { name: string; enabled: boolean }[],
): Set<string> {
  return new Set(interfaces.filter((i) => i.enabled).map((i) => i.name));
}

export function membersExisting(
  profile: InterfaceProfile,
  interfaceNames: ReadonlySet<string>,
): Set<string> {
  return new Set(profile.members.filter((m) => interfaceNames.has(m)));
}

export function activeInterfaceProfileId(
  state: InterfaceProfilesState,
  interfaces: readonly { name: string; enabled: boolean }[],
): string | null {
  const enabled = enabledInterfaceNames(interfaces);
  const names = new Set(interfaces.map((i) => i.name));
  for (const p of state.profiles) {
    const members = membersExisting(p, names);
    if (members.size === enabled.size && [...members].every((m) => enabled.has(m))) {
      return p.id;
    }
  }
  return null;
}

export function createInterfaceProfile(
  state: InterfaceProfilesState,
  name: string,
  members: string[] = [],
): InterfaceProfilesState {
  const ids = new Set(state.profiles.map((p) => p.id));
  const id = newProfileId(ids);
  return {
    ...state,
    profiles: [...state.profiles, { id, name: name.trim() || 'Profile', members: [...members] }],
  };
}

export function saveCurrentAsInterfaceProfile(
  state: InterfaceProfilesState,
  name: string,
  interfaces: readonly { name: string; enabled: boolean }[],
): InterfaceProfilesState {
  const members = [...enabledInterfaceNames(interfaces)].sort();
  return createInterfaceProfile(state, name, members);
}

export function renameInterfaceProfile(
  state: InterfaceProfilesState,
  id: string,
  name: string,
): InterfaceProfilesState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return {
    ...state,
    profiles: state.profiles.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
  };
}

export function deleteInterfaceProfile(
  state: InterfaceProfilesState,
  id: string,
): InterfaceProfilesState {
  return { ...state, profiles: state.profiles.filter((p) => p.id !== id) };
}

export function setInterfaceProfileMembers(
  state: InterfaceProfilesState,
  id: string,
  members: string[],
  validNames: ReadonlySet<string>,
): InterfaceProfilesState {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of members) {
    if (!validNames.has(m) || seen.has(m)) continue;
    seen.add(m);
    ordered.push(m);
  }
  return {
    ...state,
    profiles: state.profiles.map((p) => (p.id === id ? { ...p, members: ordered } : p)),
  };
}

/**
 * Remember the live enabled-set as Default when it matches no named profile
 * (NomadNet update_default_if_custom).
 */
export function updateDefaultInterfaceMembersIfCustom(
  state: InterfaceProfilesState,
  interfaces: readonly { name: string; enabled: boolean }[],
): InterfaceProfilesState {
  if (state.profiles.length === 0) return state;
  const enabled = [...enabledInterfaceNames(interfaces)].sort();
  const names = new Set(interfaces.map((i) => i.name));
  const matchesNamed = state.profiles.some((p) => {
    const members = [...membersExisting(p, names)].sort();
    return members.length === enabled.length && members.every((m, i) => m === enabled[i]);
  });
  if (matchesNamed) return state;
  if (
    state.defaultMembers?.length === enabled.length &&
    state.defaultMembers.every((m, i) => m === enabled[i])
  ) {
    return state;
  }
  return { ...state, defaultMembers: enabled };
}

export function pruneInterfaceProfiles(
  state: InterfaceProfilesState,
  validNames: ReadonlySet<string>,
): InterfaceProfilesState {
  const profiles = state.profiles.map((p) => ({
    ...p,
    members: p.members.filter((m) => validNames.has(m)),
  }));
  const changed = profiles.some(
    (p, i) => p.members.length !== (state.profiles[i]?.members.length ?? 0),
  );
  return changed ? { ...state, profiles } : state;
}

export type InterfaceEnableToggle = (
  id: string,
  enabled: boolean,
  ifaceTypeName?: string,
) => boolean | undefined | Promise<boolean | undefined>;

/**
 * Apply an enable-set: enable members, disable the rest.
 * Stops early when a toggle reports failure (`false`).
 */
export async function applyInterfaceEnableSet(
  interfaces: readonly { id: string; name: string; enabled: boolean; type: string }[],
  members: ReadonlySet<string>,
  toggle: InterfaceEnableToggle,
): Promise<{ changed: boolean; needsRestartHint: boolean; ok: boolean }> {
  let changed = false;
  let needsRestartHint = false;
  for (const iface of interfaces) {
    const want = members.has(iface.name);
    if (iface.enabled === want) continue;
    changed = true;
    const result = await Promise.resolve(toggle(iface.id, want, iface.type));
    if (result === false) {
      return { changed, needsRestartHint, ok: false };
    }
    if (want) needsRestartHint = true;
  }
  return { changed, needsRestartHint, ok: true };
}
