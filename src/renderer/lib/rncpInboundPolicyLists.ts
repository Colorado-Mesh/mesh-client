import type { RemoteInboundPolicyRow } from '@/shared/remote-types';

/**
 * Map SQLite inbound policy rows to the sidecar `allowed` / `blocked` hash lists
 * used by `rncp.setListener`. Hashes are lowercased; empty decisions are omitted.
 */
export function policiesToRncpLists(
  policies: Iterable<RemoteInboundPolicyRow> | Map<string, RemoteInboundPolicyRow>,
): { allowed: string[]; blocked: string[] } {
  const allowed: string[] = [];
  const blocked: string[] = [];
  const rows = policies instanceof Map ? policies.values() : policies;
  for (const row of rows) {
    const hash = row.identity_hash.trim().toLowerCase();
    if (!hash) continue;
    if (row.decision === 'allow') allowed.push(hash);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
    else if (row.decision === 'block') blocked.push(hash);
  }
  return { allowed, blocked };
}
