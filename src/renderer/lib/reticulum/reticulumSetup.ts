import {
  buildDefaultHubAddRequest,
  findInterfaceForHubPresetEndpoint,
  type ReticulumDefaultHubPreset,
} from './reticulumDefaultHubPresets';
import { isReticulumInterfaceOnlineStatus } from './reticulumLocalInterfaceHealth';
import type { ReticulumInterfaceRow } from './useReticulumInterfaceSnapshot';

export type SetupApi = Pick<
  typeof window.electronAPI.reticulum,
  'proxyGet' | 'proxyPost' | 'proxyPut'
>;

export interface ReticulumSetupSnapshot {
  rnsReady: boolean;
  messagingReady: boolean;
  interfaces: ReticulumInterfaceRow[];
}

/** Read live readiness without mistaking the listen-first HTTP server for a working network. */
export async function readReticulumSetupSnapshot(api: SetupApi): Promise<ReticulumSetupSnapshot> {
  const [status, rows] = (await Promise.all([
    api.proxyGet('/api/v1/status'),
    api.proxyGet('/api/v1/interfaces'),
  ])) as [{ rns_ready?: boolean; lxmf_ready?: boolean }, { interfaces?: ReticulumInterfaceRow[] }];
  if (!Array.isArray(rows.interfaces)) throw new Error('SETUP_INTERFACES_UNAVAILABLE');
  return {
    rnsReady: status.rns_ready === true,
    messagingReady: status.lxmf_ready === true,
    interfaces: rows.interfaces,
  };
}

/** Configure only the chosen public hub. Re-reading first makes retries safe after partial success. */
export async function enableReticulumSetupHub(
  api: SetupApi,
  preset: ReticulumDefaultHubPreset,
): Promise<void> {
  const body = (await api.proxyGet('/api/v1/interfaces')) as {
    interfaces?: ReticulumInterfaceRow[];
  };
  if (!Array.isArray(body.interfaces)) throw new Error('SETUP_INTERFACES_UNAVAILABLE');
  const existing = findInterfaceForHubPresetEndpoint(body.interfaces, preset);
  if (existing?.network_name || existing?.passphrase) {
    throw new Error('SETUP_PRIVATE_INTERFACE');
  }
  if (existing?.enabled) return;
  const result = (
    existing
      ? await api.proxyPut(`/api/v1/interfaces/${encodeURIComponent(existing.id)}`, {
          enabled: true,
        })
      : await api.proxyPost('/api/v1/interfaces', {
          ...buildDefaultHubAddRequest(preset),
          enabled: true,
        })
  ) as { ok?: boolean; error?: string };
  if (result.ok !== true) throw new Error(result.error ?? 'SETUP_INTERFACE_SAVE_FAILED');
}

/** Never replace an existing identity, including when another panel configured it in the meantime. */
export async function saveReticulumSetupIdentity(
  api: SetupApi,
  displayName: string,
): Promise<{ mnemonic: string | null }> {
  const current = (await api.proxyGet('/api/v1/identity/status')) as { configured?: boolean };
  if (typeof current.configured !== 'boolean') throw new Error('SETUP_IDENTITY_UNAVAILABLE');
  const result = (await api.proxyPost(
    current.configured ? '/api/v1/identity/display-name' : '/api/v1/identity/generate',
    current.configured
      ? { display_name: displayName.trim() }
      : { display_name: displayName.trim(), replace: false },
  )) as { ok?: boolean; mnemonic?: string; error?: string };
  if (result.ok !== true) throw new Error(result.error ?? 'SETUP_IDENTITY_SAVE_FAILED');
  return { mnemonic: result.mnemonic ?? null };
}

export function onlineReticulumSetupInterfaces(snapshot: ReticulumSetupSnapshot) {
  return snapshot.interfaces.filter(
    (row) => row.enabled && isReticulumInterfaceOnlineStatus(row.status),
  );
}
